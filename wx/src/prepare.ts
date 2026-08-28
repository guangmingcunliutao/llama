/**
 * 从监测 Excel 洗出错误词/正确词字典（前置数据）。
 *
 * 过滤：拆开单元格里挤在一起的多词、去掉空值和自己改自己、正词至少 3 字、去重并按频次合并。
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { writeJsonl } from "./jsonl.js";
import type { TermPair } from "./types.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

const COL = {
  errorType: "错误表述方案名称",
  wrong: "错误词",
  correct: "建议更正词",
} as const;

const SPLIT = /[\r\n]+|[、；;，,]+/;

export interface PrepareDictFlags {
  input?: string;
  output?: string;
  minCorrectLen?: string | number;
  force?: boolean;
}

export interface PrepareDictReport {
  input: string;
  output: string;
  raw_rows: number;
  expanded: number;
  kept: number;
  unique_pairs: number;
  unique_wrong: number;
  unique_correct: number;
  dropped_empty: number;
  dropped_same: number;
  dropped_short: number;
}

function splitCell(value: unknown): string[] {
  if (value == null) return [];
  return String(value)
    .split(SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 一对多时广播到同一个对应词；两侧都是多个且数量相同则按位置对齐。 */
function expandPair(wrongCell: unknown, correctCell: unknown): Array<[string, string]> {
  const wrongs = splitCell(wrongCell);
  const corrects = splitCell(correctCell);
  if (!wrongs.length || !corrects.length) return [];
  if (corrects.length === 1) return wrongs.map((w) => [w, corrects[0]!]);
  if (wrongs.length === 1) return corrects.map((c) => [wrongs[0]!, c]);
  const n = Math.min(wrongs.length, corrects.length);
  return Array.from({ length: n }, (_, i) => [wrongs[i]!, corrects[i]!]);
}

function headerIndex(header: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((cell, i) => {
    if (cell != null) map[String(cell).trim()] = i;
  });
  return map;
}

export function prepareDict(flags: PrepareDictFlags = {}, cwd = process.cwd()): PrepareDictReport {
  if (!flags.input?.trim()) {
    throw new Error("缺少 --input：请指定监测 Excel 路径。");
  }
  const input = path.resolve(cwd, flags.input);
  if (!fs.existsSync(input)) {
    throw new Error(`找不到 Excel: ${input}`);
  }
  const output = flags.output
    ? path.resolve(cwd, flags.output)
    : path.resolve(cwd, "data", "term_pairs.jsonl");
  if (fs.existsSync(output) && !flags.force) {
    throw new Error(`已存在 ${output}，如需覆盖请加 --force`);
  }

  const minCorrectLen = Number(flags.minCorrectLen ?? 3);
  const workbook = XLSX.readFile(input, { dense: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel 没有工作表");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`找不到工作表 ${sheetName}`);
  const table = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  if (table.length < 2) throw new Error("Excel 没有数据行");

  const cols = headerIndex(table[0] ?? []);
  const iType = cols[COL.errorType];
  const iWrong = cols[COL.wrong];
  const iCorrect = cols[COL.correct];
  if (iWrong == null || iCorrect == null) {
    throw new Error(`表头必须包含「${COL.wrong}」「${COL.correct}」，实际: ${Object.keys(cols).join(", ")}`);
  }

  const merged = new Map<string, TermPair>();
  let rawRows = 0;
  let expanded = 0;
  let droppedEmpty = 0;
  let droppedSame = 0;
  let droppedShort = 0;

  for (const row of table.slice(1)) {
    if (!row || row.every((cell) => cell == null || String(cell).trim() === "")) continue;
    rawRows += 1;
    const errorType = (iType != null ? splitCell(row[iType])[0] : "") || "固定表述错误";
    const pairs = expandPair(row[iWrong], row[iCorrect]);
    if (!pairs.length) {
      droppedEmpty += 1;
      continue;
    }
    for (const [wrong, correct] of pairs) {
      expanded += 1;
      if (!wrong || !correct) {
        droppedEmpty += 1;
        continue;
      }
      if (wrong === correct) {
        droppedSame += 1;
        continue;
      }
      if (correct.length < minCorrectLen || wrong.length < 2) {
        droppedShort += 1;
        continue;
      }
      if (/https?:\/\//i.test(wrong) || /https?:\/\//i.test(correct)) {
        droppedEmpty += 1;
        continue;
      }
      const key = `${wrong}\t${correct}\t${errorType}`;
      const prev = merged.get(key);
      if (prev) prev.freq += 1;
      else merged.set(key, { wrong, correct, error_type: errorType, freq: 1 });
    }
  }

  const pairs = [...merged.values()].sort(
    (a, b) =>
      b.freq - a.freq ||
      a.correct.localeCompare(b.correct, "zh") ||
      a.wrong.localeCompare(b.wrong, "zh"),
  );
  writeJsonl(output, pairs);

  const report: PrepareDictReport = {
    input,
    output,
    raw_rows: rawRows,
    expanded,
    kept: pairs.reduce((sum, p) => sum + p.freq, 0),
    unique_pairs: pairs.length,
    unique_wrong: new Set(pairs.map((p) => p.wrong)).size,
    unique_correct: new Set(pairs.map((p) => p.correct)).size,
    dropped_empty: droppedEmpty,
    dropped_same: droppedSame,
    dropped_short: droppedShort,
  };
  const reportFile = output.replace(/\.jsonl$/i, ".report.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("[prepare]", JSON.stringify(report, null, 2));
  console.log(`[prepare] dict=${output}`);
  console.log(`[prepare] report=${reportFile}`);
  return report;
}

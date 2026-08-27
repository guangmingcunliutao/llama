/**
 * 加载错误词 / 正确词字典（jsonl、json、csv）。
 * 同词对按 freq 合并；检索时再按正确词分组，避免同一正确词重复搜索。
 */
import fs from "node:fs";
import path from "node:path";
import type { TermPair } from "./types.js";
import { isRecord } from "./util.js";

function field(row: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = row[name];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  const lower = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  );
  for (const name of names) {
    const value = lower[name.toLowerCase()];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function loadJsonl(file: string): unknown[] {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown);
}

function loadCsv(file: string): Record<string, unknown>[] {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0]!.split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row: Record<string, unknown> = {};
    headers.forEach((header, i) => {
      row[header] = cols[i] ?? "";
    });
    return row;
  });
}

/** 去重合并后按频次降序。列名同时认英文和中文（错误词 / 建议更正词）。 */
export function loadDictionary(file: string): TermPair[] {
  if (!fs.existsSync(file)) throw new Error(`字典文件不存在: ${file}`);
  const ext = path.extname(file).toLowerCase();
  let rows: unknown[];
  if (ext === ".jsonl") rows = loadJsonl(file);
  else if (ext === ".json") {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("JSON 字典必须是对象数组");
    rows = parsed;
  } else if (ext === ".csv") rows = loadCsv(file);
  else throw new Error(`不支持的字典格式: ${ext}（可用 jsonl/json/csv）`);

  const merged = new Map<string, number>();
  for (const item of rows) {
    if (!isRecord(item)) continue;
    const wrong = field(item, ["wrong", "error", "错误词", "错词"]);
    const correct = field(item, ["correct", "ok", "建议更正词", "正词"]);
    const errorType = field(item, ["error_type", "type", "错误类型"]) || "固定表述错误";
    if (!wrong || !correct || wrong === correct) continue;
    const freq = Number(item.freq ?? item.count ?? 1) || 1;
    const key = `${wrong}\t${correct}\t${errorType}`;
    merged.set(key, (merged.get(key) || 0) + Math.max(freq, 1));
  }
  return [...merged.entries()]
    .map(([key, freq]) => {
      const [wrong, correct, error_type] = key.split("\t") as [string, string, string];
      return { wrong, correct, error_type, freq };
    })
    .sort(
      (a, b) =>
        b.freq - a.freq ||
        a.correct.localeCompare(b.correct, "zh") ||
        a.wrong.localeCompare(b.wrong, "zh"),
    );
}

/** 同一正确词只检索一次，再展开到它对应的全部错误词。 */
export function groupByCorrect(pairs: TermPair[]): Map<string, TermPair[]> {
  const grouped = new Map<string, TermPair[]>();
  for (const pair of pairs) {
    const list = grouped.get(pair.correct);
    if (list) list.push(pair);
    else grouped.set(pair.correct, [pair]);
  }
  return grouped;
}

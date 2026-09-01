import fs from "node:fs";
import path from "node:path";
import { parseFormats } from "./format.js";
import { toLfAlpaca, toLfShareGpt } from "./normalize.js";
import { readJsonl } from "./jsonl.js";
import type { ExportLfFlags, ExportLfResult, ResolvedConfig, SftExample, SftFormat } from "./types.js";

const SHAREGPT_TAGS = {
  role_tag: "from",
  content_tag: "value",
  user_tag: "human",
  assistant_tag: "gpt",
  system_tag: "system",
};

function writeJsonArray(file: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

function datasetEntry(name: string, fileName: string, formatting: "sharegpt" | "alpaca") {
  if (formatting === "sharegpt") {
    return {
      [name]: {
        file_name: fileName,
        formatting: "sharegpt",
        columns: { messages: "conversations" },
        tags: SHAREGPT_TAGS,
      },
    };
  }
  return {
    [name]: {
      file_name: fileName,
      formatting: "alpaca",
      columns: { prompt: "instruction", query: "input", response: "output" },
    },
  };
}

function readJsonObject(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    console.warn(`[export-lf] ${file} 不是合法 JSON，将按空对象合并`);
    return {};
  }
}

function mergeDatasetInfo(infoPath: string, entries: Record<string, unknown>[]): void {
  let base = readJsonObject(infoPath);
  for (const entry of entries) {
    Object.assign(base, entry);
  }
  fs.writeFileSync(infoPath, `${JSON.stringify(base, null, 2)}\n`, "utf8");
}

function writeAlpacaJsonl(file: string, rows: SftExample[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    rows.map((r) => JSON.stringify(toLfAlpaca(r))).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

function exportSplitFile(
  rows: SftExample[],
  baseName: string,
  datasetDir: string,
  prefix: string,
  instruction: string,
  formats: SftFormat[],
): { files: Record<string, string>; infoEntries: Record<string, unknown>[] } {
  const files: Record<string, string> = {};
  const infoEntries: Record<string, unknown>[] = [];
  const datasetKey = `${prefix}_${baseName}`;

  if (formats.includes("alpaca")) {
    const fileName = `${prefix}_${baseName}.jsonl`;
    const filePath = path.join(datasetDir, fileName);
    writeAlpacaJsonl(filePath, rows);
    files.alpaca = filePath;
    infoEntries.push(datasetEntry(datasetKey, fileName, "alpaca"));
  }

  if (formats.includes("sharegpt")) {
    const fileName = `${prefix}_${baseName}.json`;
    const filePath = path.join(datasetDir, fileName);
    writeJsonArray(filePath, rows.map((r) => toLfShareGpt(r, instruction)));
    files.sharegpt = filePath;
    const sgKey = formats.includes("alpaca") ? `${datasetKey}_sharegpt` : datasetKey;
    infoEntries.push(datasetEntry(sgKey, fileName, "sharegpt"));
  }

  return { files, infoEntries };
}

/** 将 split 产物写入 LlamaFactory dataset_dir，并合并 dataset_info.json。 */
export function exportLf(cfg: ResolvedConfig, flags: ExportLfFlags = {}): ExportLfResult {
  const datasetDir = flags.datasetDir
    ? path.isAbsolute(flags.datasetDir)
      ? flags.datasetDir
      : path.resolve(cfg.root, flags.datasetDir)
    : cfg.lfDatasetDir;
  if (!datasetDir) {
    throw new Error("请指定 --dataset-dir 或在配置里设置 llamafactory.datasetDir");
  }
  const prefix = flags.prefix || cfg.lfPrefix || "corr";
  const infoPath = path.join(datasetDir, flags.datasetInfo || cfg.lfDatasetInfo || "dataset_info.json");
  const formats = parseFormats(flags.format, cfg.formats);

  const slices: Array<{ key: string; path: string; lfName: string }> = [
    { key: "train", path: cfg.paths.trainSplit, lfName: "train" },
    { key: "eval_seen", path: cfg.paths.evalSeen, lfName: "eval_seen" },
    { key: "eval_unseen", path: cfg.paths.evalUnseen, lfName: "eval_unseen" },
    { key: "eval_keep", path: cfg.paths.evalKeep, lfName: "eval_keep" },
    { key: "eval", path: cfg.paths.eval, lfName: "eval" },
  ];

  const files: Record<string, string> = {};
  const datasets: string[] = [];
  const infoEntries: Record<string, unknown>[] = [];

  for (const slice of slices) {
    if (!fs.existsSync(slice.path)) continue;
    const rows = readJsonl<SftExample>(slice.path, "empty");
    if (!rows.length) continue;
    const out = exportSplitFile(rows, slice.lfName, datasetDir, prefix, cfg.instruction, formats);
    if (out.files.alpaca) files[slice.key] = out.files.alpaca;
    if (out.files.sharegpt) files[`${slice.key}_sharegpt`] = out.files.sharegpt;
    for (const entry of out.infoEntries) {
      datasets.push(...Object.keys(entry));
    }
    infoEntries.push(...out.infoEntries);
  }

  mergeDatasetInfo(infoPath, infoEntries);
  const result: ExportLfResult = {
    datasetDir,
    datasetInfo: infoPath,
    prefix,
    datasets,
    files,
    formats,
  };
  console.log("[export-lf]", JSON.stringify(result, null, 2));
  return result;
}

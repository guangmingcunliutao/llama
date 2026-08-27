import fs from "node:fs";
import path from "node:path";
import { writeJsonl } from "./jsonl.js";
import { normalizeRows, readDatasetRows } from "./normalize.js";
import type { ImportFlags, ImportResult, ResolvedConfig } from "./types.js";

export function importDataset(cfg: ResolvedConfig, flags: ImportFlags = {}): ImportResult {
  const input =
    flags.input ||
    cfg.importSource ||
    (() => {
      throw new Error("请指定 --input 或在配置里设置 import.source");
    })();
  const inputPath = path.isAbsolute(input) ? input : path.resolve(cfg.root, input);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`导入文件不存在: ${inputPath}`);
  }

  const limit = flags.limit ?? cfg.importLimit ?? null;
  let rows = readDatasetRows(inputPath, limit);

  const normalized = normalizeRows(rows, { instruction: cfg.instruction });
  if (!normalized.length) {
    throw new Error(`未能从 ${inputPath} 解析出有效样本（支持 alpaca / sharegpt / conversations）`);
  }

  const output = flags.output || cfg.paths.sft;
  writeJsonl(output, normalized);
  console.log(`[import] ${inputPath} -> ${output} (${normalized.length} rows)`);
  return { input: inputPath, output, count: normalized.length };
}

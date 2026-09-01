import fs from "node:fs";
import path from "node:path";
import { countJsonl, loadUserConfig, prepareDict } from "@model-training/core";

export async function datasetStatus(cwd: string) {
  const cfg = await loadUserConfig({ command: "status", cwd });
  const dictPath = cfg.dict;
  const trainPath = cfg.paths.sft;
  const evalPath = cfg.paths.eval;
  return {
    dict: {
      path: dictPath,
      exists: Boolean(dictPath && fs.existsSync(dictPath)),
      rows: dictPath ? countJsonl(dictPath) : 0,
    },
    train: {
      path: trainPath,
      exists: fs.existsSync(trainPath),
      rows: countJsonl(trainPath),
    },
    eval: {
      path: evalPath,
      exists: fs.existsSync(evalPath),
      rows: countJsonl(evalPath),
    },
  };
}

export function saveSeedAndPrepare(opts: {
  cwd: string;
  dictPath: string;
  tmpFile: string;
  originalName: string;
}): { mode: "copy" | "prepare"; dict: string } {
  fs.mkdirSync(path.dirname(opts.dictPath), { recursive: true });
  const ext = path.extname(opts.originalName).toLowerCase();
  if (ext === ".jsonl" || ext === ".json") {
    fs.copyFileSync(opts.tmpFile, opts.dictPath);
    return { mode: "copy", dict: opts.dictPath };
  }
  prepareDict({ input: opts.tmpFile, output: opts.dictPath, force: true }, opts.cwd);
  return { mode: "prepare", dict: opts.dictPath };
}

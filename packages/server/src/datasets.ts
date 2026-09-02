/**
 * 数据集状态与种子导入。Excel/CSV 走 prepareDict，jsonl 直接覆盖字典。
 */
import fs from "node:fs";
import path from "node:path";
import { countJsonl, loadUserConfig, loadWorkspace, prepareDict, dataRunPaths } from "@model-training/core";

export async function datasetStatus(cwd: string) {
  const cfg = await loadUserConfig({ command: "status", cwd });
  const dictPath = cfg.dict;
  const ws = loadWorkspace(cfg.outDir);
  const trainPath = ws.dataRunId ? dataRunPaths(cfg.outDir, ws.dataRunId).train : null;
  const evalPath = ws.dataRunId ? dataRunPaths(cfg.outDir, ws.dataRunId).eval : null;
  return {
    dict: {
      path: dictPath,
      exists: Boolean(dictPath && fs.existsSync(dictPath)),
      rows: dictPath ? countJsonl(dictPath) : 0,
    },
    train: {
      path: trainPath,
      exists: Boolean(trainPath && fs.existsSync(trainPath)),
      rows: trainPath ? countJsonl(trainPath) : 0,
    },
    eval: {
      path: evalPath,
      exists: Boolean(evalPath && fs.existsSync(evalPath)),
      rows: evalPath ? countJsonl(evalPath) : 0,
    },
    workspace: ws,
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

/** 根据路径判断量化源：GGUF 文件或 HuggingFace 目录。 */
export function detectQuantSource(target: string): {
  exists: boolean;
  kind: "missing" | "hf-dir" | "gguf" | "file";
  path: string;
} {
  const exists = fs.existsSync(target);
  let kind: "missing" | "hf-dir" | "gguf" | "file" = "missing";
  if (exists) {
    const st = fs.statSync(target);
    if (st.isDirectory()) kind = "hf-dir";
    else if (target.toLowerCase().endsWith(".gguf")) kind = "gguf";
    else kind = "file";
  }
  return { exists, kind, path: target };
}

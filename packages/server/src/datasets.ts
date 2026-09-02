/**
 * 数据集状态与种子导入。Excel/CSV 走 prepareDict，jsonl 直接覆盖字典。
 */
import fs from "node:fs";
import path from "node:path";
import { countJsonl, dataRunPaths, loadUserConfig, loadWorkspace, materializeEvalSlices, prepareDict } from "@model-training/core";

export async function datasetStatus(cwd: string) {
  const cfg = await loadUserConfig({ command: "status", cwd });
  const dictPath = cfg.dict;
  const ws = loadWorkspace(cfg.outDir);
  const evalPaths = ws.dataRunId ? dataRunPaths(cfg.outDir, ws.dataRunId) : null;
  if (evalPaths) {
    const hasSource = fs.existsSync(evalPaths.evalRaw) || fs.existsSync(evalPaths.eval);
    const missingSlices =
      !fs.existsSync(evalPaths.evalSeen) && !fs.existsSync(evalPaths.evalUnseen) && !fs.existsSync(evalPaths.evalKeep);
    if (hasSource && missingSlices) {
      if (!fs.existsSync(evalPaths.evalRaw) && fs.existsSync(evalPaths.eval)) {
        fs.copyFileSync(evalPaths.eval, evalPaths.evalRaw);
      }
      materializeEvalSlices(evalPaths);
    }
  }
  const fileStat = (file: string | null) => ({
    path: file,
    exists: Boolean(file && fs.existsSync(file)),
    rows: file ? countJsonl(file) : 0,
  });
  return {
    dict: fileStat(dictPath),
    train: fileStat(evalPaths?.train ?? null),
    eval: fileStat(evalPaths?.eval ?? null),
    evalSeen: fileStat(evalPaths?.evalSeen ?? null),
    evalUnseen: fileStat(evalPaths?.evalUnseen ?? null),
    evalKeep: fileStat(evalPaths?.evalKeep ?? null),
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

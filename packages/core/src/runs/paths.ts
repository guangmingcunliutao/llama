import path from "node:path";
import type { DataRunPaths, EvalRunPaths, RunKind, TrainRunPaths } from "./types.js";

export function kindRoot(outDir: string, kind: RunKind): string {
  return path.join(outDir, kind);
}

export function workspaceFile(outDir: string): string {
  return path.join(outDir, "workspace.json");
}

export function dataRunPaths(outDir: string, id: string): DataRunPaths {
  const dir = path.join(outDir, "data", id);
  const evalDir = path.join(dir, "eval");
  return {
    dir,
    run: path.join(dir, "run.json"),
    params: path.join(dir, "params.json"),
    progress: path.join(dir, "progress.json"),
    logs: path.join(dir, "logs.txt"),
    train: path.join(dir, "train.jsonl"),
    trainSharegpt: path.join(dir, "train_sharegpt.jsonl"),
    evalDir,
    evalRaw: path.join(evalDir, "raw.jsonl"),
    eval: path.join(evalDir, "eval.jsonl"),
    evalSeen: path.join(evalDir, "eval_seen_pair.jsonl"),
    evalUnseen: path.join(evalDir, "eval_unseen_pair.jsonl"),
    evalKeep: path.join(evalDir, "eval_keep.jsonl"),
    splitReport: path.join(dir, "reports", "split.json"),
  };
}

export function trainRunPaths(outDir: string, id: string): TrainRunPaths {
  const dir = path.join(outDir, "train", id);
  const lf = path.join(dir, "lf");
  return {
    dir,
    run: path.join(dir, "run.json"),
    params: path.join(dir, "params.json"),
    logs: path.join(dir, "logs.txt"),
    yaml: path.join(dir, "train.yaml"),
    lf,
    sftCopy: path.join(lf, "term_sft.jsonl"),
    ckpt: path.join(dir, "ckpt"),
    quant: path.join(dir, "quant"),
  };
}

export function evalRunPaths(outDir: string, id: string): EvalRunPaths {
  const dir = path.join(outDir, "eval", id);
  const inferDir = path.join(dir, "infer");
  const reports = path.join(dir, "reports");
  return {
    dir,
    run: path.join(dir, "run.json"),
    params: path.join(dir, "params.json"),
    logs: path.join(dir, "logs.txt"),
    lf: path.join(dir, "lf"),
    predictYaml: path.join(dir, "predict.yaml"),
    lfPredict: path.join(dir, "lf-predict"),
    inferDir,
    pred: path.join(inferDir, "pred.jsonl"),
    predSeen: path.join(inferDir, "pred_seen_pair.jsonl"),
    predUnseen: path.join(inferDir, "pred_unseen_pair.jsonl"),
    predKeep: path.join(inferDir, "pred_keep.jsonl"),
    metrics: path.join(reports, "metrics.json"),
    scored: path.join(reports, "scored.jsonl"),
    analysis: path.join(reports, "analysis.md"),
  };
}

export function unselectedDataPaths(outDir: string): DataRunPaths {
  return dataRunPaths(outDir, ".unselected");
}

export function unselectedTrainPaths(outDir: string): TrainRunPaths {
  return trainRunPaths(outDir, ".unselected");
}

export function unselectedEvalPaths(outDir: string): EvalRunPaths {
  return evalRunPaths(outDir, ".unselected");
}

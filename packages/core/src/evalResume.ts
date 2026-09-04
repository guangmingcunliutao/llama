/**
 * 评估续跑：按切片跳过已写完的预测，并从中断切片已有的 {id, pred} 接着做。
 */
import fs from "node:fs";
import path from "node:path";
import { pidAlive } from "./killTree.js";
import { readJsonlLenient } from "./jsonl.js";
import { dataRunPaths, evalRunPaths } from "./runs/paths.js";
import type { DataRunPaths, EvalRunPaths, RunMeta } from "./runs/types.js";
import type { PredictionRow, SftExample } from "./types.js";

export interface EvalSliceFiles {
  name: string;
  gold: string;
  pred: string;
}

export interface EvalRunProgress {
  totalGold: number;
  doneGold: number;
  totalSlices: number;
  doneSlices: number;
  salvageable: boolean;
}

export function goldId(gold: SftExample, index: number): string | number {
  return gold.id ?? index;
}

export function withStableIds(golds: SftExample[]): SftExample[] {
  return golds.map((row, index) => (row.id == null ? { ...row, id: index } : row));
}

export function predMap(rows: PredictionRow[]): Map<string, PredictionRow> {
  const map = new Map<string, PredictionRow>();
  for (const row of rows) {
    if (row == null || row.id == null) continue;
    map.set(String(row.id), row);
  }
  return map;
}

export function isSliceComplete(golds: SftExample[], preds: PredictionRow[]): boolean {
  if (!golds.length) return true;
  const have = predMap(preds);
  return golds.every((row, index) => have.has(String(goldId(row, index))));
}

export function missingGolds(golds: SftExample[], preds: PredictionRow[]): SftExample[] {
  const have = predMap(preds);
  return golds.filter((row, index) => !have.has(String(goldId(row, index))));
}

export function mergePreds(golds: SftExample[], ...parts: PredictionRow[][]): PredictionRow[] {
  const have = new Map<string, PredictionRow>();
  for (const part of parts) {
    for (const row of part) {
      if (row == null || row.id == null) continue;
      have.set(String(row.id), row);
    }
  }
  return golds.map((row, index) => {
    const id = goldId(row, index);
    return have.get(String(id)) ?? { id, pred: "" };
  });
}

export function positionalPreds(
  golds: SftExample[],
  lfRows: Array<{ predict?: string; prediction?: string }>,
): PredictionRow[] {
  const n = Math.min(golds.length, lfRows.length);
  const rows: PredictionRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: goldId(golds[i]!, i),
      pred: String(lfRows[i]?.predict ?? lfRows[i]?.prediction ?? "").trim(),
    });
  }
  return rows;
}

export function readPreds(file: string): PredictionRow[] {
  return readJsonlLenient<PredictionRow>(file).filter((row) => row && row.id != null);
}

export function evalSliceFiles(data: DataRunPaths, evalP: EvalRunPaths): EvalSliceFiles[] {
  return [
    { name: "eval", gold: data.eval, pred: evalP.pred },
    { name: "eval_seen_pair", gold: data.evalSeen, pred: evalP.predSeen },
    { name: "eval_unseen_pair", gold: data.evalUnseen, pred: evalP.predUnseen },
    { name: "eval_keep", gold: data.evalKeep, pred: evalP.predKeep },
  ];
}

function countSalvageable(lfPredict: string): number {
  const direct = path.join(lfPredict, "generated_predictions.jsonl");
  if (fs.existsSync(direct)) return readJsonlLenient(direct).length;
  if (!fs.existsSync(lfPredict)) return 0;
  for (const name of fs.readdirSync(lfPredict)) {
    const nested = path.join(lfPredict, name, "generated_predictions.jsonl");
    if (fs.existsSync(nested)) return readJsonlLenient(nested).length;
  }
  return 0;
}

export function evalRunProgress(outDir: string, meta: RunMeta): EvalRunProgress {
  const evalP = evalRunPaths(outDir, meta.id);
  const dataId = meta.dataRunId;
  const slices = dataId ? evalSliceFiles(dataRunPaths(outDir, dataId), evalP) : [];
  let totalGold = 0;
  let doneGold = 0;
  let totalSlices = 0;
  let doneSlices = 0;
  for (const slice of slices) {
    const golds = readJsonlLenient<SftExample>(slice.gold);
    if (!golds.length) continue;
    totalSlices += 1;
    totalGold += golds.length;
    const preds = readPreds(slice.pred);
    const done = golds.filter((row, index) => predMap(preds).has(String(goldId(row, index)))).length;
    doneGold += done;
    if (done === golds.length) doneSlices += 1;
  }
  return {
    totalGold,
    doneGold,
    totalSlices,
    doneSlices,
    salvageable: countSalvageable(evalP.lfPredict) > 0,
  };
}

export function evalCanResume(outDir: string, meta: RunMeta): { ok: boolean; hint: string } {
  if (meta.status === "running" && pidAlive(meta.pid)) {
    return { ok: false, hint: "正在评估" };
  }
  const progress = evalRunProgress(outDir, meta);
  if (progress.totalSlices > 0 && progress.doneSlices === progress.totalSlices) {
    return { ok: false, hint: "该评估已完成" };
  }
  if (meta.status === "completed" && progress.doneSlices === progress.totalSlices) {
    return { ok: false, hint: "该评估已完成" };
  }
  if (meta.status === "pending" && progress.doneGold === 0 && !progress.salvageable) {
    return { ok: false, hint: "还没有进度" };
  }
  if (progress.doneGold > 0) {
    return { ok: true, hint: `已预测 ${progress.doneGold}/${progress.totalGold} 条，可继续未完成切片` };
  }
  if (progress.salvageable) {
    return { ok: true, hint: "发现中断的 LlamaFactory 预测，可续上" };
  }
  if (meta.status === "interrupted" || meta.status === "failed") {
    return { ok: true, hint: "中断后尚无落盘预测，继续会从当前评估实验重跑未完成切片" };
  }
  return { ok: false, hint: `状态 ${meta.status} 不能续跑` };
}

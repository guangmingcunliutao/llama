/**
 * 把独立检索的验证样本拆成评估用的四份文件，对齐原来的 split 产物。
 *
 * eval.jsonl            seen + unseen 错句（不含 keep）
 * eval_seen_pair.jsonl  词对在训练集里出现过、句子是新的
 * eval_unseen_pair.jsonl 整组词对未进训练
 * eval_keep.jsonl       本身正确、不应改动
 */
import { writeJsonl, readJsonl } from "./jsonl.js";
import { pairKeyForRow } from "./normalize.js";
import type { DataRunPaths } from "./runs/types.js";
import type { SftExample } from "./types.js";

function isKeep(row: SftExample): boolean {
  if (row.error_type === "keep" || row.split === "keep") return true;
  return Boolean(row.input && row.output && row.input === row.output && !row.wrong);
}

export function trainPairKeys(trainFile: string): Set<string> {
  return new Set(
    readJsonl<SftExample>(trainFile, "empty")
      .filter((row) => !isKeep(row))
      .map((row) => pairKeyForRow(row)),
  );
}

export interface EvalSliceCounts {
  eval: number;
  eval_seen_pair: number;
  eval_unseen_pair: number;
  eval_keep: number;
}

export function materializeEvalSlices(paths: DataRunPaths): EvalSliceCounts {
  const rows = readJsonl<SftExample>(paths.evalRaw, "empty");
  const trained = trainPairKeys(paths.train);
  const seen: SftExample[] = [];
  const unseen: SftExample[] = [];
  const keep: SftExample[] = [];

  for (const row of rows) {
    if (isKeep(row)) {
      keep.push({ ...row, split: "eval_keep", error_type: "keep" });
      continue;
    }
    const key = pairKeyForRow(row);
    if (trained.has(key)) {
      seen.push({ ...row, split: "eval_seen_pair" });
    } else {
      unseen.push({ ...row, split: "eval_unseen_pair" });
    }
  }

  const errors = [...seen, ...unseen];
  writeJsonl(paths.eval, errors);
  writeJsonl(paths.evalSeen, seen);
  writeJsonl(paths.evalUnseen, unseen);
  writeJsonl(paths.evalKeep, keep);
  return {
    eval: errors.length,
    eval_seen_pair: seen.length,
    eval_unseen_pair: unseen.length,
    eval_keep: keep.length,
  };
}

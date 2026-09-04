import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAll, prepareEvalAll } from "../evaluate.js";
import { writeJsonl } from "../jsonl.js";
import { createRun, findEvalRunWithPred } from "../runs/store.js";
import { evalRunPaths } from "../runs/paths.js";
import type { ResolvedConfig, SftExample } from "../types.js";

function gold(id: string, split: string): SftExample {
  return {
    id,
    instruction: "",
    input: "错句",
    output: "对句",
    wrong: "错",
    correct: "对",
    error_type: "固定表述错误",
    source: "",
    url: "",
    article_id: "",
    split,
  };
}

function stubCfg(dir: string): ResolvedConfig {
  const goldDir = path.join(dir, "gold");
  const inferDir = path.join(dir, "infer");
  const reports = path.join(dir, "reports");
  fs.mkdirSync(goldDir, { recursive: true });
  fs.mkdirSync(inferDir, { recursive: true });
  fs.mkdirSync(reports, { recursive: true });
  return {
    paths: {
      sft: path.join(dir, "train.jsonl"),
      eval: path.join(goldDir, "eval.jsonl"),
      evalSeen: path.join(goldDir, "eval_seen_pair.jsonl"),
      evalUnseen: path.join(goldDir, "eval_unseen_pair.jsonl"),
      evalKeep: path.join(goldDir, "eval_keep.jsonl"),
      pred: path.join(inferDir, "pred.jsonl"),
      predSeen: path.join(inferDir, "pred_seen_pair.jsonl"),
      predUnseen: path.join(inferDir, "pred_unseen_pair.jsonl"),
      predKeep: path.join(inferDir, "pred_keep.jsonl"),
      metrics: path.join(reports, "metrics.json"),
      scored: path.join(reports, "scored.jsonl"),
    },
  } as unknown as ResolvedConfig;
}

describe("evaluateAll", () => {
  it("rebuilds eval.jsonl and pred.jsonl from seen/unseen slices", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-eval-all-"));
    const cfg = stubCfg(dir);
    writeJsonl(cfg.paths.evalSeen, [gold("s", "eval_seen_pair")]);
    writeJsonl(cfg.paths.evalUnseen, [gold("u", "eval_unseen_pair")]);
    writeJsonl(cfg.paths.predSeen, [{ id: "s", pred: "对句" }]);
    writeJsonl(cfg.paths.predUnseen, [{ id: "u", pred: "对句" }]);
    const ready = prepareEvalAll(cfg);
    expect(ready).toEqual({ gold: true, pred: true });
    const report = evaluateAll(cfg, { all: true });
    expect(report.n).toBe(2);
    expect(report.exact_match).toBe(1);
    expect(report.slices?.eval_seen_pair?.n).toBe(1);
    expect(report.slices?.eval_unseen_pair?.n).toBe(1);
    expect(fs.existsSync(cfg.paths.metrics)).toBe(true);
  });

  it("names the missing gold and pred files instead of asking to split", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-eval-miss-"));
    const cfg = stubCfg(dir);
    expect(() => evaluateAll(cfg, { all: true })).toThrow(/无法打分：缺少/);
    expect(() => evaluateAll(cfg, { all: true })).toThrow(/开始评估/);
    expect(() => evaluateAll(cfg, { all: true })).not.toThrow(/split/);
  });
});

describe("findEvalRunWithPred", () => {
  it("skips empty eval runs and returns the latest with pred.jsonl", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-eval-run-"));
    const empty = createRun(outDir, { kind: "eval", mode: "fresh", label: "empty" });
    const filled = createRun(outDir, {
      kind: "eval",
      mode: "fresh",
      label: "filled",
      extra: { trainRunId: "t1", dataRunId: "d1" },
    });
    writeJsonl(evalRunPaths(outDir, filled.id).pred, [{ id: 0, pred: "对句" }]);
    expect(findEvalRunWithPred(outDir, { preferId: empty.id })).toBe(filled.id);
    expect(findEvalRunWithPred(outDir, { preferId: filled.id })).toBe(filled.id);
    expect(findEvalRunWithPred(outDir, { trainRunId: "t1", dataRunId: "d1" })).toBe(filled.id);
  });
});

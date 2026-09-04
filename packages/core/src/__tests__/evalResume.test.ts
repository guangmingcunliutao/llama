import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evalCanResume, isSliceComplete, mergePreds, missingGolds, withStableIds } from "../evalResume.js";
import { infer } from "../infer.js";
import { writeJsonl } from "../jsonl.js";
import { createRun, patchRun, summarizeRun } from "../runs/store.js";
import { dataRunPaths, evalRunPaths } from "../runs/paths.js";
import type { ResolvedConfig, SftExample } from "../types.js";

function gold(id: string, split: string): SftExample {
  return {
    id,
    instruction: "",
    input: `错${id}`,
    output: `对${id}`,
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
    infer: { backend: "rule" },
  } as unknown as ResolvedConfig;
}

describe("eval resume helpers", () => {
  it("treats a slice as complete only when every gold id has a pred", () => {
    const golds = withStableIds([gold("a", "eval"), gold("b", "eval")]);
    expect(isSliceComplete(golds, [{ id: "a", pred: "对a" }])).toBe(false);
    expect(isSliceComplete(golds, [{ id: "a", pred: "对a" }, { id: "b", pred: "对b" }])).toBe(true);
    expect(missingGolds(golds, [{ id: "a", pred: "对a" }]).map((row) => row.id)).toEqual(["b"]);
    expect(mergePreds(golds, [{ id: "a", pred: "对a" }], [{ id: "b", pred: "对b" }])).toEqual([
      { id: "a", pred: "对a" },
      { id: "b", pred: "对b" },
    ]);
  });

  it("allows resuming an interrupted eval that already has some preds", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-eval-resume-"));
    const data = createRun(outDir, { kind: "data", mode: "fresh", label: "d" });
    const dataP = dataRunPaths(outDir, data.id);
    writeJsonl(dataP.eval, [gold("a", "eval"), gold("b", "eval")]);
    writeJsonl(dataP.evalSeen, [gold("a", "eval_seen_pair")]);
    const evalRun = createRun(outDir, {
      kind: "eval",
      mode: "fresh",
      label: "e",
      extra: { dataRunId: data.id, trainRunId: "t1" },
    });
    writeJsonl(evalRunPaths(outDir, evalRun.id).pred, [{ id: "a", pred: "对a" }]);
    patchRun(outDir, "eval", evalRun.id, { status: "interrupted" });
    const live = summarizeRun(outDir, evalRun);
    expect(live.canResume).toBe(true);
    expect(evalCanResume(outDir, { ...evalRun, status: "interrupted" }).ok).toBe(true);
    expect(live.resumeHint).toMatch(/已预测/);
  });
});

describe("infer resume", () => {
  it("skips a finished slice and fills the rest", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-infer-resume-"));
    const cfg = stubCfg(dir);
    writeJsonl(cfg.paths.eval, [gold("a", "eval"), gold("b", "eval")]);
    writeJsonl(cfg.paths.evalSeen, [gold("s", "eval_seen_pair")]);
    writeJsonl(cfg.paths.pred, [{ id: "a", pred: "keep-a" }]);
    await infer(cfg, { backend: "rule", all: true });
    const pred = JSON.parse(fs.readFileSync(cfg.paths.pred, "utf8").trim().split("\n")[0]!);
    expect(pred).toEqual({ id: "a", pred: "keep-a" });
    const rest = fs
      .readFileSync(cfg.paths.pred, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string; pred: string });
    expect(rest).toEqual([
      { id: "a", pred: "keep-a" },
      { id: "b", pred: "对b" },
    ]);
    const seen = fs
      .readFileSync(cfg.paths.predSeen, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string });
    expect(seen.map((row) => row.id)).toEqual(["s"]);
  });
});

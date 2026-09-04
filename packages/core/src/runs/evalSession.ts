import { evalRunPaths } from "./paths.js";
import { createRun, loadWorkspace, patchWorkspace, readRun, summarizeRun } from "./store.js";
import type { EvalRunPaths, RunMeta, RunMode } from "./types.js";

export function parseEvalMode(value: unknown): Extract<RunMode, "fresh" | "resume"> | undefined {
  if (value === "fresh" || value === "resume") return value;
  return undefined;
}

export function resolveEvalSession(
  outDir: string,
  flags: {
    mode?: string;
    runId?: string;
    trainRunId?: string | null;
    dataRunId?: string | null;
    label?: string;
  },
): { meta: RunMeta; paths: EvalRunPaths } {
  const ws = loadWorkspace(outDir);
  const mode = parseEvalMode(flags.mode) ?? (flags.runId ? "resume" : "fresh");
  if (mode === "resume") {
    const id = flags.runId || ws.evalRunId;
    if (!id) throw new Error("没有可继续的评估实验");
    const meta = readRun(outDir, "eval", id);
    if (!meta) throw new Error(`找不到评估实验 ${id}`);
    const live = summarizeRun(outDir, meta);
    if (!live.canResume) throw new Error(live.resumeHint || "该评估不能续跑");
    if (flags.trainRunId && meta.trainRunId && flags.trainRunId !== meta.trainRunId) {
      throw new Error(`该评估属于训练 ${meta.trainRunId}，与当前选择不一致。请改选对应训练，或全新评估。`);
    }
    patchWorkspace(outDir, {
      evalRunId: id,
      trainRunId: meta.trainRunId ?? flags.trainRunId ?? ws.trainRunId,
    });
    return { meta, paths: evalRunPaths(outDir, id) };
  }

  const meta = createRun(outDir, {
    kind: "eval",
    mode: "fresh",
    label: flags.label || "eval",
    extra: { trainRunId: flags.trainRunId, dataRunId: flags.dataRunId },
  });
  patchWorkspace(outDir, {
    evalRunId: meta.id,
    trainRunId: flags.trainRunId ?? ws.trainRunId,
  });
  return { meta, paths: evalRunPaths(outDir, meta.id) };
}

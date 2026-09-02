import fs from "node:fs";
import path from "node:path";
import { fingerprintFile, fingerprintValue } from "./fingerprint.js";
import { trainRunPaths } from "./paths.js";
import { findLatestCheckpoint, resumeBlockedReason } from "./trainResume.js";
import { hasLoraAdapter } from "./adapter.js";
import {
  createRun,
  loadWorkspace,
  patchWorkspace,
  readRun,
  readTrainParams,
  requireDataRun,
  summarizeRun,
  writeTrainParams,
} from "./store.js";
import type { RunMeta, RunMode, TrainParams, TrainRunPaths } from "./types.js";

export function parseTrainMode(value: unknown): RunMode | undefined {
  if (value === "fresh" || value === "resume" || value === "continue") return value;
  return undefined;
}

export function inferTrainMode(outDir: string, flags: { mode?: string; runId?: string; parentId?: string }): RunMode {
  const explicit = parseTrainMode(flags.mode);
  if (explicit) return explicit;
  if (flags.runId) return "resume";
  if (flags.parentId) return "continue";
  const current = loadWorkspace(outDir).trainRunId;
  if (current) {
    const meta = readRun(outDir, "train", current);
    if (meta && summarizeRun(outDir, meta).canResume) return "resume";
  }
  return "fresh";
}

export interface TrainSession {
  meta: RunMeta;
  paths: TrainRunPaths;
  params: TrainParams;
  resumeFrom: string | null;
}

export function resolveTrainSession(
  outDir: string,
  flags: {
    mode?: string;
    runId?: string;
    parentId?: string;
    dataRunId?: string;
    label?: string;
    knobs?: Record<string, string | number | boolean>;
  },
): TrainSession {
  const mode = inferTrainMode(outDir, flags);
  const knobs = flags.knobs ?? {};
  const ws = loadWorkspace(outDir);

  if (mode === "resume") {
    const id = flags.runId || ws.trainRunId;
    if (!id) throw new Error("没有可继续的训练实验");
    const meta = readRun(outDir, "train", id);
    if (!meta) throw new Error(`找不到训练实验 ${id}`);
    const stored = readTrainParams(outDir, id);
    if (!stored) throw new Error(`训练实验 ${id} 缺少 params.json`);
    const blocked = resumeBlockedReason(stored.knobs, knobs);
    if (blocked) throw new Error(blocked);
    const dataFp = fingerprintFile(trainRunPaths(outDir, id).sftCopy);
    if (stored.dataFingerprint && dataFp && stored.dataFingerprint !== dataFp) {
      throw new Error("训练数据已变化，不能从中断处继续。请全新训练或基于上次再训练。");
    }
    const resumeFrom = findLatestCheckpoint(trainRunPaths(outDir, id).ckpt);
    if (!resumeFrom) throw new Error("没有 checkpoint，无法从中断处继续");
    patchWorkspace(outDir, { trainRunId: id });
    return { meta, paths: trainRunPaths(outDir, id), params: stored, resumeFrom };
  }

  if (mode === "continue") {
    const parentId = flags.parentId || ws.trainRunId;
    if (!parentId) throw new Error("再训练需要指定上一份训练实验");
    const parent = readRun(outDir, "train", parentId);
    if (!parent) throw new Error(`找不到训练实验 ${parentId}`);
    const parentPaths = trainRunPaths(outDir, parentId);
    if (!hasLoraAdapter(parentPaths.ckpt)) {
      throw new Error("上一份训练还没有可用的 LoRA adapter，不能在此基础上再训练");
    }
    const parentParams = readTrainParams(outDir, parentId);
    const dataRunId = flags.dataRunId || parent.dataRunId || ws.dataRunId;
    const data = requireDataRun(outDir, dataRunId);
    if (!fs.existsSync(data.paths.train)) throw new Error(`没有训练集 ${data.paths.train}`);
    const dataFingerprint = fingerprintFile(data.paths.train) || "";
    const mergedKnobs = { ...(parentParams?.knobs ?? {}), ...knobs };
    const params: TrainParams = {
      knobs: mergedKnobs,
      dataRunId: data.meta.id,
      dataFingerprint,
      parentId,
    };
    const meta = createRun(outDir, {
      kind: "train",
      mode: "continue",
      label: flags.label || parent.label,
      parentId,
      extra: {
        dataRunId: data.meta.id,
        dataFingerprint,
        paramsFingerprint: fingerprintValue(params),
      },
    });
    const paths = trainRunPaths(outDir, meta.id);
    fs.copyFileSync(data.paths.train, paths.sftCopy);
    writeTrainParams(outDir, meta.id, params);
    patchWorkspace(outDir, { trainRunId: meta.id, dataRunId: data.meta.id });
    return { meta, paths, params, resumeFrom: null };
  }

  const dataRunId = flags.dataRunId || ws.dataRunId;
  const data = requireDataRun(outDir, dataRunId);
  if (!fs.existsSync(data.paths.train)) throw new Error(`没有训练集 ${data.paths.train}，请先在「数据生成」页生成`);
  const dataFingerprint = fingerprintFile(data.paths.train) || "";
  const params: TrainParams = {
    knobs,
    dataRunId: data.meta.id,
    dataFingerprint,
    parentId: null,
  };
  const meta = createRun(outDir, {
    kind: "train",
    mode: "fresh",
    label: flags.label || "train",
    extra: {
      dataRunId: data.meta.id,
      dataFingerprint,
      paramsFingerprint: fingerprintValue(params),
    },
  });
  const paths = trainRunPaths(outDir, meta.id);
  fs.mkdirSync(path.dirname(paths.sftCopy), { recursive: true });
  fs.copyFileSync(data.paths.train, paths.sftCopy);
  writeTrainParams(outDir, meta.id, params);
  patchWorkspace(outDir, { trainRunId: meta.id, dataRunId: data.meta.id });
  return { meta, paths, params, resumeFrom: null };
}

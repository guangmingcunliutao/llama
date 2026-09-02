import fs from "node:fs";
import path from "node:path";
import type { GenerateFlags, ResolvedConfig } from "../types.js";
import { fingerprintValue } from "./fingerprint.js";
import { dataRunPaths } from "./paths.js";
import {
  createRun,
  emptyProgress,
  loadWorkspace,
  patchRun,
  patchWorkspace,
  readDataParams,
  readDataProgress,
  readRun,
  summarizeRun,
  writeDataParams,
  writeDataProgress,
} from "./store.js";
import type { DataParams, DataProgress, DataRunPaths, RunMeta, RunMode } from "./types.js";

function toNumber(value: string | number | null | undefined, fallback: number): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseRunMode(value: unknown): RunMode | undefined {
  if (value === "fresh" || value === "resume" || value === "continue") return value;
  return undefined;
}

export function dataParamsFrom(cfg: ResolvedConfig, flags: GenerateFlags): DataParams {
  const rawLimit =
    flags.limitTerms != null && flags.limitTerms !== ""
      ? Number(flags.limitTerms)
      : cfg.limitTerms;
  const cleanRaw = Number(flags.cleanRatio ?? cfg.cleanRatio ?? 0);
  return {
    pairsPerTerm: toNumber(flags.pairsPerTerm, cfg.pairsPerTerm),
    limitTerms: rawLimit != null && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : null,
    cleanRatio: Math.min(1, Math.max(0, cleanRaw > 1 ? cleanRaw / 100 : cleanRaw)),
    maxPages: Math.max(1, toNumber(flags.maxPages, cfg.maxPages || 1)),
    instruction: flags.instruction?.trim() || cfg.instruction,
    sources: flags.sources?.length
      ? flags.sources
      : flags.source
        ? [flags.source]
        : cfg.sources.filter((item) => item.enabled !== false).map((item) => item.name),
    formats: flags.format ? flags.format.split(/[,+\s]+/).filter(Boolean) : [...cfg.formats],
    minLen: cfg.sentence.minLen,
    maxLen: cfg.sentence.maxLen,
  };
}

export function inferDataMode(cfg: ResolvedConfig, flags: GenerateFlags): RunMode {
  const explicit = parseRunMode(flags.mode);
  if (explicit) return explicit;
  if (flags.runId) return "resume";
  if (flags.parentId) return "continue";
  const current = loadWorkspace(cfg.outDir).dataRunId;
  if (current) {
    const meta = readRun(cfg.outDir, "data", current);
    if (meta) {
      const sum = summarizeRun(cfg.outDir, meta);
      if (sum.canResume) return "resume";
    }
  }
  return "fresh";
}

function copyIfExists(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

export interface DataSession {
  meta: RunMeta;
  paths: DataRunPaths;
  params: DataParams;
  progress: DataProgress;
}

export function resolveDataSession(cfg: ResolvedConfig, flags: GenerateFlags): DataSession {
  const mode = inferDataMode(cfg, flags);
  const incoming = dataParamsFrom(cfg, flags);
  const label = (flags.label || incoming.sources[0] || "data").trim();

  if (mode === "resume") {
    const id = flags.runId || loadWorkspace(cfg.outDir).dataRunId;
    if (!id) throw new Error("没有可继续的数据实验");
    const meta = readRun(cfg.outDir, "data", id);
    if (!meta) throw new Error(`找不到数据实验 ${id}`);
    const stored = readDataParams(cfg.outDir, id);
    if (!stored) throw new Error(`数据实验 ${id} 缺少 params.json`);
    if (fingerprintValue(stored) !== fingerprintValue(incoming)) {
      throw new Error("生成参数已变，不能按中断续跑。请全新生成，或「在上次基础上追加」。");
    }
    const live = summarizeRun(cfg.outDir, meta);
    if (!live.canResume) throw new Error(live.resumeHint || "该实验不能续跑");
    patchWorkspace(cfg.outDir, { dataRunId: id });
    return {
      meta,
      paths: dataRunPaths(cfg.outDir, id),
      params: stored,
      progress: readDataProgress(cfg.outDir, id),
    };
  }

  if (mode === "continue") {
    const parentId = flags.parentId || loadWorkspace(cfg.outDir).dataRunId;
    if (!parentId) throw new Error("追加生成需要指定上一份数据实验");
    const parent = readRun(cfg.outDir, "data", parentId);
    if (!parent) throw new Error(`找不到数据实验 ${parentId}`);
    const parentPaths = dataRunPaths(cfg.outDir, parentId);
    const meta = createRun(cfg.outDir, {
      kind: "data",
      mode: "continue",
      label,
      parentId,
      extra: { phase: "generating_train", paramsFingerprint: fingerprintValue(incoming) },
    });
    const paths = dataRunPaths(cfg.outDir, meta.id);
    copyIfExists(parentPaths.train, paths.train);
    copyIfExists(parentPaths.trainSharegpt, paths.trainSharegpt);
    writeDataParams(cfg.outDir, meta.id, incoming);
    const progress = emptyProgress("generating_train");
    progress.writtenError = 0;
    writeDataProgress(cfg.outDir, meta.id, progress);
    patchWorkspace(cfg.outDir, { dataRunId: meta.id });
    return { meta, paths, params: incoming, progress };
  }

  const meta = createRun(cfg.outDir, {
    kind: "data",
    mode: "fresh",
    label,
    extra: { phase: "generating_train", paramsFingerprint: fingerprintValue(incoming) },
  });
  const paths = dataRunPaths(cfg.outDir, meta.id);
  writeDataParams(cfg.outDir, meta.id, incoming);
  const progress = emptyProgress("generating_train");
  writeDataProgress(cfg.outDir, meta.id, progress);
  patchWorkspace(cfg.outDir, { dataRunId: meta.id });
  return { meta, paths, params: incoming, progress };
}

export function resolveEvalSession(cfg: ResolvedConfig, flags: GenerateFlags): DataSession {
  const id = flags.runId || loadWorkspace(cfg.outDir).dataRunId;
  if (!id) throw new Error("没有选中的数据实验，请先生成训练集");
  const meta = readRun(cfg.outDir, "data", id);
  if (!meta) throw new Error(`找不到数据实验 ${id}`);
  const paths = dataRunPaths(cfg.outDir, id);
  if (!fs.existsSync(paths.train)) throw new Error(`没有训练集 ${paths.train}，请先生成训练数据`);
  const stored = readDataParams(cfg.outDir, id);
  const incoming = dataParamsFrom(cfg, flags);
  const params = stored ?? incoming;
  const mode = parseRunMode(flags.mode) ?? "resume";
  if (mode === "fresh") {
    for (const file of [paths.eval, paths.evalSeen, paths.evalUnseen, paths.evalKeep]) {
      if (fs.existsSync(file)) fs.rmSync(file);
    }
    const progress = readDataProgress(cfg.outDir, id);
    progress.phase = "generating_eval";
    progress.evalTermIndex = 0;
    progress.evalWritten = 0;
    progress.evalKeep = 0;
    progress.skippedLeak = 0;
    writeDataProgress(cfg.outDir, id, progress);
    patchRun(cfg.outDir, "data", id, { phase: "generating_eval", status: "pending" });
    patchWorkspace(cfg.outDir, { dataRunId: id });
    return { meta: readRun(cfg.outDir, "data", id)!, paths, params, progress };
  }
  patchWorkspace(cfg.outDir, { dataRunId: id });
  const progress = readDataProgress(cfg.outDir, id);
  if (progress.phase === "generating_train") {
    throw new Error("训练集尚未完成，请先继续生成训练集");
  }
  return { meta, paths, params, progress };
}

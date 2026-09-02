import fs from "node:fs";
import path from "node:path";
import { countJsonl } from "../jsonl.js";
import { pidAlive } from "../killTree.js";
import { isRecord } from "../util.js";
import { hasLoraAdapter } from "./adapter.js";
import { allocateRunId } from "./id.js";
import {
  dataRunPaths,
  evalRunPaths,
  kindRoot,
  trainRunPaths,
  workspaceFile,
} from "./paths.js";
import { findLatestCheckpoint } from "./trainResume.js";
import type {
  DataParams,
  DataProgress,
  DataRunPaths,
  EvalRunPaths,
  RunKind,
  RunMeta,
  RunMode,
  RunSummary,
  TrainParams,
  TrainRunPaths,
  WorkspacePointer,
} from "./types.js";

const EMPTY_WORKSPACE: WorkspacePointer = {
  dataRunId: null,
  trainRunId: null,
  evalRunId: null,
};

export function emptyProgress(phase: DataProgress["phase"] = "idle"): DataProgress {
  return {
    phase,
    termIndex: 0,
    termTotal: 0,
    currentCorrect: "",
    writtenError: 0,
    writtenKeep: 0,
    evalTermIndex: 0,
    evalWritten: 0,
    evalKeep: 0,
    skippedLeak: 0,
  };
}

export function atomicWriteJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    if (fs.existsSync(file)) fs.rmSync(file);
    fs.renameSync(tmp, file);
  }
}

export function readJsonFile<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadWorkspace(outDir: string): WorkspacePointer {
  const raw = readJsonFile<Partial<WorkspacePointer>>(workspaceFile(outDir));
  if (!raw) return { ...EMPTY_WORKSPACE };
  return {
    dataRunId: raw.dataRunId ?? null,
    trainRunId: raw.trainRunId ?? null,
    evalRunId: raw.evalRunId ?? null,
  };
}

export function saveWorkspace(outDir: string, pointer: WorkspacePointer): WorkspacePointer {
  const next: WorkspacePointer = {
    dataRunId: pointer.dataRunId ?? null,
    trainRunId: pointer.trainRunId ?? null,
    evalRunId: pointer.evalRunId ?? null,
  };
  atomicWriteJson(workspaceFile(outDir), next);
  return next;
}

export function patchWorkspace(outDir: string, patch: Partial<WorkspacePointer>): WorkspacePointer {
  return saveWorkspace(outDir, { ...loadWorkspace(outDir), ...patch });
}

export function pathsFor(outDir: string, kind: RunKind, id: string): DataRunPaths | TrainRunPaths | EvalRunPaths {
  if (kind === "data") return dataRunPaths(outDir, id);
  if (kind === "train") return trainRunPaths(outDir, id);
  return evalRunPaths(outDir, id);
}

export function readRun(outDir: string, kind: RunKind, id: string): RunMeta | null {
  const file =
    kind === "data"
      ? dataRunPaths(outDir, id).run
      : kind === "train"
        ? trainRunPaths(outDir, id).run
        : evalRunPaths(outDir, id).run;
  const raw = readJsonFile<RunMeta>(file);
  if (!raw || !raw.id) return null;
  return raw;
}

export function writeRun(outDir: string, meta: RunMeta): RunMeta {
  const next = { ...meta, updatedAt: new Date().toISOString() };
  const file =
    next.kind === "data"
      ? dataRunPaths(outDir, next.id).run
      : next.kind === "train"
        ? trainRunPaths(outDir, next.id).run
        : evalRunPaths(outDir, next.id).run;
  atomicWriteJson(file, next);
  return next;
}

export function patchRun(outDir: string, kind: RunKind, id: string, patch: Partial<RunMeta>): RunMeta {
  const current = readRun(outDir, kind, id);
  if (!current) throw new Error(`找不到实验 ${kind}/${id}`);
  return writeRun(outDir, { ...current, ...patch, id, kind });
}

export function readDataParams(outDir: string, id: string): DataParams | null {
  return readJsonFile<DataParams>(dataRunPaths(outDir, id).params);
}

export function writeDataParams(outDir: string, id: string, params: DataParams): void {
  atomicWriteJson(dataRunPaths(outDir, id).params, params);
}

export function readDataProgress(outDir: string, id: string): DataProgress {
  return readJsonFile<DataProgress>(dataRunPaths(outDir, id).progress) ?? emptyProgress();
}

export function writeDataProgress(outDir: string, id: string, progress: DataProgress): void {
  atomicWriteJson(dataRunPaths(outDir, id).progress, progress);
}

export function readTrainParams(outDir: string, id: string): TrainParams | null {
  return readJsonFile<TrainParams>(trainRunPaths(outDir, id).params);
}

export function writeTrainParams(outDir: string, id: string, params: TrainParams): void {
  atomicWriteJson(trainRunPaths(outDir, id).params, params);
}

export function appendRunLog(logFile: string, line: string): void {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${line}\n`, "utf8");
}

export function tailLog(logFile: string, maxLines = 2000): string[] {
  if (!fs.existsSync(logFile)) return [];
  const lines = fs.readFileSync(logFile, "utf8").split(/\r?\n/).filter((line) => line.length > 0);
  return lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
}

export function createRun(
  outDir: string,
  opts: {
    kind: RunKind;
    mode: RunMode;
    label: string;
    parentId?: string | null;
    extra?: Partial<RunMeta>;
  },
): RunMeta {
  const id = allocateRunId(outDir, opts.kind, opts.label);
  const now = new Date().toISOString();
  const meta: RunMeta = {
    id,
    kind: opts.kind,
    status: "pending",
    mode: opts.mode,
    parentId: opts.parentId ?? null,
    createdAt: now,
    updatedAt: now,
    label: opts.label.trim() || id,
    pid: null,
    error: null,
    exitCode: null,
    ...opts.extra,
  };
  const paths = pathsFor(outDir, opts.kind, id);
  fs.mkdirSync(paths.dir, { recursive: true });
  writeRun(outDir, meta);
  if (opts.kind === "data") {
    const data = dataRunPaths(outDir, id);
    fs.mkdirSync(data.evalDir, { recursive: true });
    writeDataProgress(outDir, id, emptyProgress("idle"));
  }
  if (opts.kind === "train") {
    fs.mkdirSync(trainRunPaths(outDir, id).lf, { recursive: true });
    fs.mkdirSync(trainRunPaths(outDir, id).ckpt, { recursive: true });
  }
  if (opts.kind === "eval") {
    fs.mkdirSync(evalRunPaths(outDir, id).inferDir, { recursive: true });
    fs.mkdirSync(evalRunPaths(outDir, id).lf, { recursive: true });
  }
  return meta;
}

function dataCanResume(meta: RunMeta, progress: DataProgress): { ok: boolean; hint: string } {
  if (meta.status === "completed" && progress.phase === "completed") {
    return { ok: false, hint: "该数据实验已完成" };
  }
  if (meta.status === "running") return { ok: false, hint: "正在运行" };
  if (progress.phase === "idle" && progress.termIndex === 0 && progress.writtenError === 0) {
    return { ok: false, hint: "还没有进度" };
  }
  if (meta.status === "interrupted" || meta.status === "failed" || meta.status === "pending") {
    return { ok: true, hint: `从 ${progress.phase} 词 ${progress.termIndex} 继续` };
  }
  if (progress.phase === "train_done" || progress.phase === "generating_eval") {
    return { ok: true, hint: "可继续生成验证集" };
  }
  return { ok: false, hint: `状态 ${meta.status} 不能续跑` };
}

function trainCanResume(outDir: string, meta: RunMeta): { ok: boolean; hint: string } {
  if (meta.status === "completed") return { ok: false, hint: "该训练已完成，请用「基于上次再训练」" };
  if (meta.status === "running") return { ok: false, hint: "正在训练" };
  const ckpt = trainRunPaths(outDir, meta.id).ckpt;
  const latest = findLatestCheckpoint(ckpt);
  if (!latest) return { ok: false, hint: "没有 checkpoint，无法从中断处继续" };
  return { ok: true, hint: `从 ${path.basename(latest)} 继续` };
}

export function reconcileRun(outDir: string, meta: RunMeta): RunMeta {
  if (meta.status !== "running") return meta;
  if (pidAlive(meta.pid)) return meta;
  const latest =
    meta.kind === "train" ? findLatestCheckpoint(trainRunPaths(outDir, meta.id).ckpt) : null;
  return patchRun(outDir, meta.kind, meta.id, {
    status: "interrupted",
    pid: null,
    lastCheckpoint: latest ? path.basename(latest) : meta.lastCheckpoint,
    resumeFrom: latest,
  });
}

export function summarizeRun(outDir: string, meta: RunMeta): RunSummary {
  const live = reconcileRun(outDir, meta);
  let canResume = false;
  let resumeHint = "";
  let trainRows: number | undefined;
  let evalRows: number | undefined;
  let lastCheckpoint = live.lastCheckpoint ?? null;
  let adapterReady = live.adapterReady ?? false;

  if (live.kind === "data") {
    const paths = dataRunPaths(outDir, live.id);
    trainRows = countJsonl(paths.train);
    evalRows = countJsonl(paths.eval);
    const progress = readDataProgress(outDir, live.id);
    const resume = dataCanResume(live, progress);
    canResume = resume.ok;
    resumeHint = resume.hint;
  } else if (live.kind === "train") {
    const paths = trainRunPaths(outDir, live.id);
    const latest = findLatestCheckpoint(paths.ckpt);
    lastCheckpoint = latest ? path.basename(latest) : lastCheckpoint;
    adapterReady = hasLoraAdapter(paths.ckpt);
    const resume = trainCanResume(outDir, live);
    canResume = resume.ok;
    resumeHint = resume.hint;
  } else {
    resumeHint = "评估不提供样本级续跑";
  }

  return {
    id: live.id,
    kind: live.kind,
    status: live.status,
    label: live.label,
    createdAt: live.createdAt,
    updatedAt: live.updatedAt,
    mode: live.mode,
    parentId: live.parentId,
    phase: live.phase,
    trainRows,
    evalRows,
    lastCheckpoint,
    adapterReady,
    canResume,
    resumeHint,
    dataRunId: live.dataRunId ?? null,
    trainRunId: live.trainRunId ?? null,
  };
}

export function listRuns(outDir: string, kind: RunKind): RunSummary[] {
  const root = kindRoot(outDir, kind);
  if (!fs.existsSync(root)) return [];
  const rows: RunSummary[] = [];
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith(".")) continue;
    const meta = readRun(outDir, kind, name);
    if (!meta) continue;
    rows.push(summarizeRun(outDir, meta));
  }
  rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return rows;
}

export function deleteRun(outDir: string, kind: RunKind, id: string): WorkspacePointer {
  const dir = pathsFor(outDir, kind, id).dir;
  if (!fs.existsSync(dir)) throw new Error(`找不到实验目录 ${kind}/${id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const ws = loadWorkspace(outDir);
  const patch: Partial<WorkspacePointer> = {};
  if (kind === "data" && ws.dataRunId === id) patch.dataRunId = null;
  if (kind === "train" && ws.trainRunId === id) patch.trainRunId = null;
  if (kind === "eval" && ws.evalRunId === id) patch.evalRunId = null;
  return Object.keys(patch).length ? patchWorkspace(outDir, patch) : ws;
}

export function selectRun(outDir: string, kind: RunKind, id: string): WorkspacePointer {
  if (!readRun(outDir, kind, id)) throw new Error(`找不到实验 ${kind}/${id}`);
  if (kind === "data") return patchWorkspace(outDir, { dataRunId: id });
  if (kind === "train") return patchWorkspace(outDir, { trainRunId: id });
  return patchWorkspace(outDir, { evalRunId: id });
}

export function requireDataRun(outDir: string, id: string | null | undefined): { meta: RunMeta; paths: DataRunPaths } {
  if (!id) throw new Error("没有选中的数据实验，请先生成数据");
  const meta = readRun(outDir, "data", id);
  if (!meta) throw new Error(`找不到数据实验 ${id}`);
  return { meta, paths: dataRunPaths(outDir, id) };
}

export function requireTrainRun(outDir: string, id: string | null | undefined): { meta: RunMeta; paths: TrainRunPaths } {
  if (!id) throw new Error("没有选中的训练实验");
  const meta = readRun(outDir, "train", id);
  if (!meta) throw new Error(`找不到训练实验 ${id}`);
  return { meta, paths: trainRunPaths(outDir, id) };
}

export function isDataParams(value: unknown): value is DataParams {
  return isRecord(value) && typeof value.pairsPerTerm === "number";
}

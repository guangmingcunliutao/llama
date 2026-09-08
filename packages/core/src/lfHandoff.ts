/**
 * LlamaFactory WebUI 交接：稳定导出目录 + 输出目录占坑。
 * 登记文件放在 lf-meta，不要放进 output_dir（LF 可能清空该目录）。
 */
import fs from "node:fs";
import path from "node:path";
import { resolveLoraAdapterDir } from "./runs/adapter.js";
import { fingerprintFile } from "./runs/fingerprint.js";
import { slugifyLabel, timestampId } from "./runs/id.js";
import { dataRunPaths, trainRunPaths } from "./runs/paths.js";
import { listRuns, loadWorkspace, readRun, requireDataRun } from "./runs/store.js";
import { resolveEvalSession } from "./runs/evalSession.js";
import { hasEvalGold } from "./evalSlices.js";
import { countJsonl, readJsonl } from "./jsonl.js";
import { toLfAlpaca } from "./normalize.js";
import { parseTrainYaml } from "./trainYaml.js";
import { isRecord } from "./util.js";
import type { ExportLfResult, ResolvedConfig, SftExample, TrainKnobs } from "./types.js";

export const TERM_TRAIN = "term_train";
export const TERM_EVAL = "term_eval";

export interface LfExportManifest {
  dataRunId: string | null;
  trainFingerprint: string | null;
  evalFingerprint: string | null;
  trainRows: number;
  evalRows: number;
  datasets: string[];
  exportedAt: string;
}

export interface LfRunMeta {
  id: string;
  createdAt: string;
  label: string;
  dataRunId: string | null;
  dataFingerprint: string | null;
  knobs: TrainKnobs;
  note?: string;
}

export interface LfArtifact {
  id: string;
  source: "lf" | "legacy";
  label: string;
  outputDir: string;
  outputDirForLf: string;
  adapterDir: string | null;
  adapterReady: boolean;
  dataRunId: string | null;
  dataFingerprint: string | null;
  knobs: TrainKnobs;
  createdAt: string;
  note?: string;
}

function posix(p: string): string {
  return p.replaceAll("\\", "/");
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function lfExportRoot(cfg: ResolvedConfig): string {
  return cfg.lfExportDir;
}

export function lfRunsRoot(outDir: string): string {
  return path.join(outDir, "lf-runs");
}

export function lfMetaDir(outDir: string): string {
  return path.join(outDir, "lf-meta");
}

export function lfRunDir(outDir: string, id: string): string {
  return path.join(lfRunsRoot(outDir), id);
}

export function lfMetaPath(outDir: string, id: string): string {
  return path.join(lfMetaDir(outDir), `${id}.json`);
}

/** LF 进程里应填写的路径（容器内即 POSIX；本机保持原路径）。 */
export function pathForLlamaFactory(absPath: string): string {
  return posix(path.resolve(absPath));
}

export function alpacaEntry(fileName: string): Record<string, unknown> {
  return {
    file_name: fileName,
    formatting: "alpaca",
    columns: {
      prompt: "instruction",
      query: "input",
      response: "output",
    },
  };
}

function writeAlpacaJsonl(file: string, rows: SftExample[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    rows.map((row) => JSON.stringify(toLfAlpaca(row))).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

export function knobsFromOutputDir(dir: string, fallback: TrainKnobs = {}): TrainKnobs {
  const merged: TrainKnobs = { ...fallback };
  const yamlFiles = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    : [];
  for (const name of yamlFiles) {
    Object.assign(merged, parseTrainYaml(fs.readFileSync(path.join(dir, name), "utf8")));
  }
  for (const name of ["training_args.json", "adapter_config.json"]) {
    const raw = readJson<Record<string, unknown>>(path.join(dir, name));
    if (!raw) continue;
    const rank = raw.r ?? raw.lora_rank;
    if (typeof rank === "number") merged.lora_rank = rank;
    const loraAlpha = raw.lora_alpha;
    if (typeof loraAlpha === "number") merged.lora_alpha = loraAlpha;
    const loraDropout = raw.lora_dropout;
    if (typeof loraDropout === "number") merged.lora_dropout = loraDropout;
    const lr = raw.learning_rate;
    if (typeof lr === "number" || typeof lr === "string") merged.learning_rate = lr;
    const epochs = raw.num_train_epochs;
    if (typeof epochs === "number") merged.num_train_epochs = epochs;
    const cutoff = raw.cutoff_len;
    if (typeof cutoff === "number") merged.cutoff_len = cutoff;
    const template = raw.template;
    if (typeof template === "string") merged.template = template;
    const model = raw.model_name_or_path ?? raw.base_model_name_or_path;
    if (typeof model === "string") merged.model_name_or_path = model;
  }
  const adapter = resolveLoraAdapterDir(dir);
  if (adapter && adapter !== dir) {
    return knobsFromOutputDir(adapter, merged);
  }
  return merged;
}

/** 写出 outputs/lf：train/ eval/ dataset_info.json + manifest.json。 */
export function exportLfBoard(cfg: ResolvedConfig, datasetDir = cfg.lfExportDir): ExportLfResult {
  const ws = loadWorkspace(cfg.outDir);
  const dataId = ws.dataRunId;
  const dataPaths = dataId ? dataRunPaths(cfg.outDir, dataId) : null;
  const trainFile = dataPaths?.train || cfg.paths.trainSplit;
  const evalSrc = dataPaths?.eval || cfg.paths.eval;
  if (!fs.existsSync(trainFile)) {
    throw new Error(`没有训练集 ${trainFile}，请先生成训练数据`);
  }
  const trainRows = readJsonl<SftExample>(trainFile, "empty");
  if (!trainRows.length) throw new Error(`训练集为空: ${trainFile}`);

  const trainOut = path.join(datasetDir, "train", `${TERM_TRAIN}.jsonl`);
  const evalOut = path.join(datasetDir, "eval", `${TERM_EVAL}.jsonl`);
  writeAlpacaJsonl(trainOut, trainRows);

  const info: Record<string, unknown> = {
    [TERM_TRAIN]: alpacaEntry(`train/${TERM_TRAIN}.jsonl`),
  };
  const files: Record<string, string> = { train: trainOut };
  const datasets = [TERM_TRAIN];
  let evalRows = 0;
  let evalFingerprint: string | null = null;

  if (fs.existsSync(evalSrc) && countJsonl(evalSrc) > 0) {
    const rows = readJsonl<SftExample>(evalSrc, "empty");
    writeAlpacaJsonl(evalOut, rows);
    info[TERM_EVAL] = alpacaEntry(`eval/${TERM_EVAL}.jsonl`);
    files.eval = evalOut;
    datasets.push(TERM_EVAL);
    evalRows = rows.length;
    evalFingerprint = fingerprintFile(evalSrc);
  } else if (fs.existsSync(evalOut)) {
    fs.rmSync(evalOut);
  }

  const infoPath = path.join(datasetDir, "dataset_info.json");
  writeJson(infoPath, info);

  const manifest: LfExportManifest = {
    dataRunId: dataId,
    trainFingerprint: fingerprintFile(trainFile),
    evalFingerprint,
    trainRows: trainRows.length,
    evalRows,
    datasets,
    exportedAt: new Date().toISOString(),
  };
  writeJson(path.join(datasetDir, "manifest.json"), manifest);

  const result: ExportLfResult = {
    datasetDir,
    datasetInfo: infoPath,
    prefix: "term",
    datasets,
    files,
    formats: ["alpaca"],
  };
  console.log("[export-lf]", JSON.stringify({ datasetDir, datasets, trainRows: trainRows.length, evalRows }));
  return result;
}

/** 以 workspace 当前 dataRun 为准（生成过程中 cfg.paths 可能仍是旧实验）。 */
function resolveCurrentTrainFile(cfg: ResolvedConfig): string | null {
  const ws = loadWorkspace(cfg.outDir);
  const trainFile = ws.dataRunId ? dataRunPaths(cfg.outDir, ws.dataRunId).train : cfg.paths.trainSplit;
  if (!fs.existsSync(trainFile) || countJsonl(trainFile) === 0) return null;
  return trainFile;
}

/** 生成/导入结束后同步写出 WebUI 数据集；失败只打日志，不打断主流程。 */
export function tryExportLfBoard(cfg: ResolvedConfig): ExportLfResult | null {
  try {
    if (!resolveCurrentTrainFile(cfg)) return null;
    return exportLfBoard(cfg);
  } catch (err) {
    console.warn(`[export-lf] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function readExportManifest(datasetDir: string): LfExportManifest | null {
  return readJson<LfExportManifest>(path.join(datasetDir, "manifest.json"));
}

function allocateLfId(outDir: string, label: string): string {
  const base = `${timestampId()}-${slugifyLabel(label || "sft")}`;
  let id = base;
  let n = 2;
  while (fs.existsSync(lfRunDir(outDir, id)) || fs.existsSync(lfMetaPath(outDir, id))) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

export function prepareLfRun(
  cfg: ResolvedConfig,
  flags: { label?: string; note?: string; knobs?: TrainKnobs } = {},
): { id: string; outputDir: string; meta: LfRunMeta } {
  const data = requireDataRun(cfg.outDir, loadWorkspace(cfg.outDir).dataRunId);
  if (!fs.existsSync(data.paths.train) || countJsonl(data.paths.train) === 0) {
    throw new Error(`没有训练集 ${data.paths.train}，请先生成训练数据`);
  }
  tryExportLfBoard(cfg);
  const id = allocateLfId(cfg.outDir, flags.label || "sft");
  const outputDir = lfRunDir(cfg.outDir, id);
  fs.mkdirSync(outputDir, { recursive: true });
  const meta: LfRunMeta = {
    id,
    createdAt: new Date().toISOString(),
    label: flags.label?.trim() || id,
    dataRunId: data.meta.id,
    dataFingerprint: fingerprintFile(data.paths.train),
    knobs: flags.knobs ?? {},
    note: flags.note,
  };
  writeJson(lfMetaPath(cfg.outDir, id), meta);
  return { id, outputDir, meta };
}

export function readLfMeta(outDir: string, id: string): LfRunMeta | null {
  const raw = readJson<unknown>(lfMetaPath(outDir, id));
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  return raw as unknown as LfRunMeta;
}

export function listLfArtifacts(outDir: string): LfArtifact[] {
  const rows: LfArtifact[] = [];
  const runsRoot = lfRunsRoot(outDir);
  if (fs.existsSync(runsRoot)) {
    for (const ent of fs.readdirSync(runsRoot, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
      const id = ent.name;
      const outputDir = lfRunDir(outDir, id);
      const meta = readLfMeta(outDir, id);
      const adapterDir = resolveLoraAdapterDir(outputDir);
      const knobs = knobsFromOutputDir(outputDir, meta?.knobs ?? {});
      rows.push({
        id,
        source: "lf",
        label: meta?.label || id,
        outputDir,
        outputDirForLf: pathForLlamaFactory(outputDir),
        adapterDir,
        adapterReady: Boolean(adapterDir),
        dataRunId: meta?.dataRunId ?? null,
        dataFingerprint: meta?.dataFingerprint ?? null,
        knobs,
        createdAt: meta?.createdAt || fs.statSync(outputDir).mtime.toISOString(),
        note: meta?.note,
      });
    }
  }
  for (const summary of listRuns(outDir, "train")) {
    const paths = trainRunPaths(outDir, summary.id);
    rows.push({
      id: `legacy:${summary.id}`,
      source: "legacy",
      label: `${summary.label}（本仓库代训）`,
      outputDir: paths.ckpt,
      outputDirForLf: pathForLlamaFactory(paths.ckpt),
      adapterDir: summary.adapterReady ? resolveLoraAdapterDir(paths.ckpt) : null,
      adapterReady: Boolean(summary.adapterReady),
      dataRunId: summary.dataRunId ?? null,
      dataFingerprint: null,
      knobs: {},
      createdAt: summary.updatedAt,
    });
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return rows;
}

export function parseArtifactId(id: string): { source: "lf" | "legacy"; raw: string } {
  if (id.startsWith("legacy:")) return { source: "legacy", raw: id.slice("legacy:".length) };
  return { source: "lf", raw: id };
}

export function resolveArtifact(outDir: string, id: string | null | undefined): LfArtifact | null {
  if (!id?.trim()) return null;
  const { source, raw } = parseArtifactId(id);
  const all = listLfArtifacts(outDir);
  if (source === "legacy") {
    return all.find((row) => row.source === "legacy" && row.id === `legacy:${raw}`) ?? null;
  }
  return all.find((row) => row.source === "lf" && row.id === raw) ?? null;
}

export function resolveArtifactAdapter(outDir: string, id: string | null | undefined): string | undefined {
  const hit = resolveArtifact(outDir, id);
  return hit?.adapterDir ?? undefined;
}

/** 给 loadUserConfig 用：LF 占坑不是 outputs/train 里的实验。 */
export function storeTrainRunId(outDir: string, artifactId: string | null | undefined): string | null {
  if (!artifactId?.trim()) return null;
  const { source, raw } = parseArtifactId(artifactId);
  if (source === "legacy") return raw;
  if (fs.existsSync(lfRunDir(outDir, raw)) || fs.existsSync(lfMetaPath(outDir, raw))) return null;
  return raw;
}

export function dataRunIdForArtifact(outDir: string, trainRunId: string | null | undefined): string | null {
  if (!trainRunId?.trim()) return null;
  const hit = resolveArtifact(outDir, trainRunId);
  if (hit?.dataRunId) return hit.dataRunId;
  const raw = parseArtifactId(trainRunId).raw;
  const meta = readRun(outDir, "train", raw);
  return meta?.dataRunId?.trim() || null;
}

export function resolveEvalAdapterDir(
  outDir: string,
  trainRunId: string | null | undefined,
  explicit?: string | null,
): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  const fromArt = resolveArtifactAdapter(outDir, trainRunId);
  if (fromArt) return fromArt;
  if (!trainRunId?.trim()) return undefined;
  const raw = parseArtifactId(trainRunId).raw;
  const paths = trainRunPaths(outDir, raw);
  if (fs.existsSync(paths.run)) return resolveLoraAdapterDir(paths.ckpt) ?? undefined;
  return undefined;
}

export function prepareLfEval(
  cfg: ResolvedConfig,
  flags: { trainRunId: string; label?: string },
): {
  evalRunId: string;
  datasetDir: string;
  datasetDirForLf: string;
  adapterDir: string;
  adapterDirForLf: string;
  outputDir: string;
  outputDirForLf: string;
  evalDataset: string;
} {
  const trainRunId = flags.trainRunId?.trim();
  if (!trainRunId) throw new Error("请选择一次训练实验");
  const adapterDir = resolveEvalAdapterDir(cfg.outDir, trainRunId);
  if (!adapterDir) throw new Error("所选训练还没有 LoRA。请先在 LlamaFactory 训完。");
  const dataId = dataRunIdForArtifact(cfg.outDir, trainRunId);
  const data = requireDataRun(cfg.outDir, dataId);
  if (!hasEvalGold(data.paths)) {
    throw new Error(`没有验证集 ${data.paths.eval}，请先生成验证集`);
  }
  tryExportLfBoard(cfg);
  const session = resolveEvalSession(cfg.outDir, {
    mode: "fresh",
    trainRunId,
    dataRunId: data.meta.id,
    label: flags.label,
  });
  fs.mkdirSync(session.paths.lfPredict, { recursive: true });
  const datasetDir = cfg.lfExportDir;
  const info = readJson<Record<string, unknown>>(path.join(datasetDir, "dataset_info.json")) ?? {};
  if (!info[TERM_EVAL]) throw new Error("导出目录里没有 term_eval，请先生成验证集并重新导出");
  return {
    evalRunId: session.meta.id,
    datasetDir,
    datasetDirForLf: pathForLlamaFactory(datasetDir),
    adapterDir,
    adapterDirForLf: pathForLlamaFactory(adapterDir),
    outputDir: session.paths.lfPredict,
    outputDirForLf: pathForLlamaFactory(session.paths.lfPredict),
    evalDataset: TERM_EVAL,
  };
}

export function lfHandoffView(cfg: ResolvedConfig): {
  datasetDir: string;
  datasetDirForLf: string;
  hasTrain: boolean;
  hasEval: boolean;
  datasets: string[];
  manifest: LfExportManifest | null;
  webuiUrl: string;
  swanlabUrl: string;
  swanlabLogDir: string;
  swanlabLogDirForLf: string;
  artifacts: LfArtifact[];
} {
  const datasetDir = cfg.lfExportDir;
  const manifest = readExportManifest(datasetDir);
  const info = readJson<Record<string, unknown>>(path.join(datasetDir, "dataset_info.json")) ?? {};
  const swanDir = path.join(cfg.outDir, "swanlog");
  return {
    datasetDir,
    datasetDirForLf: pathForLlamaFactory(datasetDir),
    hasTrain: Boolean(info[TERM_TRAIN]),
    hasEval: Boolean(info[TERM_EVAL]),
    datasets: Object.keys(info),
    manifest,
    webuiUrl: process.env.LLAMAFACTORY_WEBUI_URL || "http://127.0.0.1:7860",
    swanlabUrl: process.env.SWANLAB_WATCH_URL || "http://127.0.0.1:5092",
    swanlabLogDir: swanDir,
    swanlabLogDirForLf: pathForLlamaFactory(swanDir),
    artifacts: listLfArtifacts(cfg.outDir),
  };
}

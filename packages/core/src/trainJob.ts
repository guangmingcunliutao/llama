import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { killProcessTree } from "./killTree.js";
import {
  decodeSubprocessBuffer,
  detectLlamaFactory,
  trainChildEnv,
  trainSpawnSpec,
} from "./llamaFactoryEnv.js";
import {
  applyModelHubEnv,
  inferModelHub,
  parseModelHub,
  resolvedModelNameOrPath,
  validateModelSource,
  type ModelHub,
} from "./modelSource.js";
import { appendRunLog, patchRun } from "./runs/store.js";
import { resolveTrainSession } from "./runs/trainSession.js";
import { resolveLoraAdapterDir } from "./runs/adapter.js";
import { findLatestCheckpoint } from "./runs/trainResume.js";
import { patchTrainYaml, parseTrainYaml } from "./trainYaml.js";
import type { ResolvedConfig } from "./types.js";

export interface TrainRunOptions {
  yamlPath: string;
  cwd?: string;
  home?: string | null;
  bin?: string;
  extraArgs?: string[];
  hub?: ModelHub | null;
  hfEndpoint?: string | null;
  modelCacheDir?: string | null;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  onSpawn?: (pid: number) => void;
}

export function resolveLlamaFactoryBin(explicit?: string): string | null {
  const found = detectLlamaFactory({ bin: explicit ?? null });
  return found.bin;
}

function emitProcessOutput(buf: Buffer, onLog?: (line: string) => void): void {
  for (const line of decodeSubprocessBuffer(buf).split(/\r?\n/)) {
    if (line.trim()) onLog?.(line);
  }
}

const DEFAULT_YAML = `### model
model_name_or_path: Qwen/Qwen3-0.6B
trust_remote_code: true

### method
stage: sft
do_train: true
finetuning_type: lora
lora_rank: 8
lora_alpha: 16
lora_dropout: 0.05
lora_target: all

### dataset
dataset: term_sft
dataset_dir: ./outputs/lf
template: qwen3
cutoff_len: 1024
max_samples: 100000
overwrite_cache: true
preprocessing_num_workers: 4

### output
output_dir: ./outputs/train
logging_steps: 10
save_steps: 50
plot_loss: true
overwrite_output_dir: true

### train
per_device_train_batch_size: 1
gradient_accumulation_steps: 8
learning_rate: 1.0e-4
num_train_epochs: 2.0
max_steps: -1
lr_scheduler_type: cosine
warmup_ratio: 0.1
bf16: true
ddp_timeout: 180000000
`;

function posixRel(from: string, to: string): string {
  const rel = path.relative(from, to).replaceAll("\\", "/");
  return rel || path.basename(to);
}

export function writeDatasetInfo(dir: string, trainFile: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const infoPath = path.join(dir, "dataset_info.json");
  const info = {
    term_sft: {
      file_name: path.isAbsolute(trainFile) ? posixRel(dir, trainFile) : trainFile,
      formatting: "alpaca",
      columns: {
        prompt: "instruction",
        query: "input",
        response: "output",
      },
    },
  };
  fs.writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`, "utf8");
  return infoPath;
}

export function ensureTrainYaml(file: string, patch?: Record<string, string | number | boolean>): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : DEFAULT_YAML;
  if (patch && Object.keys(patch).length) text = patchTrainYaml(text, patch);
  fs.writeFileSync(file, text, "utf8");
  return file;
}

export function runTrain(opts: TrainRunOptions): Promise<{ code: number; cancelled: boolean }> {
  const detect = detectLlamaFactory({ home: opts.home, bin: opts.bin });
  if (!detect.ok) {
    return Promise.reject(new Error(detect.errors.join("\n")));
  }
  const spec = trainSpawnSpec(detect, opts.yamlPath);
  const extra = opts.extraArgs ?? [];
  const args = [...spec.args, ...extra];
  const hub = opts.hub ?? "modelscope";
  if (hub === "modelscope") opts.onLog?.("[model] 线上源：ModelScope");
  if (hub === "huggingface") opts.onLog?.("[model] 线上源：Hugging Face");
  if (hub === "openmind") opts.onLog?.("[model] 线上源：魔乐 Modelers");
  if (hub === "local") opts.onLog?.("[model] 使用本地模型目录");
  opts.onLog?.(`$ ${spec.command} ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, args, {
      cwd: opts.cwd,
      env: applyModelHubEnv(
        trainChildEnv(detect),
        {
          hub,
          hfEndpoint: opts.hfEndpoint,
          cacheDir: opts.modelCacheDir,
        },
      ),
      shell: spec.shell,
      windowsHide: true,
    });
    if (child.pid) opts.onSpawn?.(child.pid);

    const onAbort = (): void => {
      killProcessTree(child);
      setTimeout(() => killProcessTree(child), 300);
    };
    opts.signal?.addEventListener("abort", onAbort);
    if (opts.signal?.aborted) onAbort();

    child.stdout?.on("data", (buf: Buffer) => emitProcessOutput(buf, opts.onLog));
    child.stderr?.on("data", (buf: Buffer) => emitProcessOutput(buf, opts.onLog));
    child.on("error", (err) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code: code ?? 1, cancelled: Boolean(opts.signal?.aborted) });
    });
  });
}

export interface StartTrainOptions {
  onLog?: (line: string) => void;
  signal?: AbortSignal;
  home?: string | null;
  bin?: string;
  hub?: ModelHub | string | null;
  hfEndpoint?: string | null;
  modelCacheDir?: string | null;
  patch?: Record<string, string | number | boolean>;
  mode?: string;
  runId?: string;
  parentId?: string;
  dataRunId?: string;
  label?: string;
}

export function prepareTrainFiles(
  cfg: ResolvedConfig,
  extraPatch?: Record<string, string | number | boolean>,
): { yamlPath: string; datasetDir: string } {
  const yamlPath = cfg.trainConfig || path.join(cfg.outDir, "llamafactory", "train_sft.yaml");
  const datasetDir = cfg.lfDatasetDir || path.join(cfg.outDir, "lf");
  const outputDir = cfg.trainOutputDir || path.join(cfg.outDir, "train");
  writeDatasetInfo(datasetDir, cfg.paths.sft);
  ensureTrainYaml(yamlPath, {
    dataset_dir: datasetDir.replaceAll("\\", "/"),
    output_dir: outputDir.replaceAll("\\", "/"),
    ...(extraPatch ?? {}),
  });
  return { yamlPath, datasetDir };
}

/** 写出 dataset_info + yaml，再 spawn llamafactory-cli train。 */
export async function startTrainFromConfig(
  cfg: ResolvedConfig,
  opts: StartTrainOptions = {},
): Promise<{ code: number; cancelled: boolean; runId: string }> {
  const session = resolveTrainSession(cfg.outDir, {
    mode: opts.mode,
    runId: opts.runId,
    parentId: opts.parentId,
    dataRunId: opts.dataRunId,
    label: opts.label,
    knobs: opts.patch,
  });
  const { paths, params, resumeFrom, adapterDir } = session;
  const runId = session.meta.id;

  const home = opts.home ?? cfg.lfHome;
  const bin = opts.bin ?? cfg.lfBin ?? undefined;
  const detect = detectLlamaFactory({ home, bin });
  if (!detect.ok) {
    patchRun(cfg.outDir, "train", runId, { status: "failed", error: detect.errors.join("\n") });
    throw new Error(detect.errors.join("\n"));
  }

  const patch: Record<string, string | number | boolean> = { ...params.knobs, ...(opts.patch ?? {}) };
  if (typeof patch.model_name_or_path !== "string" || !patch.model_name_or_path.trim()) {
    if (cfg.lfModel) patch.model_name_or_path = cfg.lfModel;
  }
  const modelRaw = typeof patch.model_name_or_path === "string" ? patch.model_name_or_path : "";
  const requestedHub = parseModelHub(opts.hub) ?? cfg.lfHub;
  if (modelRaw) {
    const hubForPath = inferModelHub(modelRaw, requestedHub);
    patch.model_name_or_path = resolvedModelNameOrPath({ root: cfg.root, model: modelRaw, hub: hubForPath });
  }
  patch.dataset_dir = paths.lf.replaceAll("\\", "/");
  patch.output_dir = paths.ckpt.replaceAll("\\", "/");
  patch.save_steps = patch.save_steps ?? 50;
  delete patch.save_total_limit;
  delete patch.resume_from_checkpoint;
  delete patch.adapter_name_or_path;
  delete patch.create_new_adapter;
  if (session.meta.mode === "resume" && resumeFrom) {
    patch.overwrite_output_dir = false;
    patch.resume_from_checkpoint = resumeFrom.replaceAll("\\", "/");
  } else {
    patch.overwrite_output_dir = true;
  }
  if (session.meta.mode === "continue") {
    const adapter = adapterDir || (session.meta.parentId
      ? resolveLoraAdapterDir(path.join(cfg.outDir, "train", session.meta.parentId, "ckpt"))
      : null);
    if (!adapter) {
      throw new Error("上一份训练还没有可用的 LoRA。需要至少保存过一份 checkpoint，或已经训完。");
    }
    patch.adapter_name_or_path = adapter.replaceAll("\\", "/");
    patch.create_new_adapter = false;
  }

  writeDatasetInfo(paths.lf, paths.sftCopy);
  ensureTrainYaml(paths.yaml, patch);
  const knobs = parseTrainYaml(fs.readFileSync(paths.yaml, "utf8"));
  const model = String(knobs.model_name_or_path ?? "");
  const hub = inferModelHub(model, requestedHub);
  const invalid = validateModelSource({ root: cfg.root, model, hub });
  if (invalid) {
    patchRun(cfg.outDir, "train", runId, { status: "failed", error: invalid });
    throw new Error(invalid);
  }

  const onLog = (line: string): void => {
    opts.onLog?.(line);
    appendRunLog(paths.logs, line);
  };
  for (const note of detect.notes) onLog(note);
  onLog(`[train] run=${runId} mode=${session.meta.mode} data=${params.dataRunId}`);
  if (resumeFrom) onLog(`[train] resume_from_checkpoint=${resumeFrom}`);
  if (session.meta.mode === "continue" && adapterDir) onLog(`[train] adapter_name_or_path=${adapterDir}`);

  patchRun(cfg.outDir, "train", runId, { status: "running", pid: process.pid, error: null });

  const result = await runTrain({
    yamlPath: paths.yaml,
    cwd: cfg.root,
    home,
    bin,
    hub,
    hfEndpoint: opts.hfEndpoint ?? cfg.lfHfEndpoint,
    modelCacheDir: opts.modelCacheDir ?? cfg.lfModelCacheDir,
    signal: opts.signal,
    onLog,
    onSpawn: (pid) => {
      patchRun(cfg.outDir, "train", runId, { status: "running", pid });
    },
  });

  const latest = findLatestCheckpoint(paths.ckpt);
  const adapterReady = Boolean(resolveLoraAdapterDir(paths.ckpt));
  if (result.cancelled) {
    patchRun(cfg.outDir, "train", runId, {
      status: "interrupted",
      pid: null,
      exitCode: 130,
      lastCheckpoint: latest ? path.basename(latest) : null,
      resumeFrom: latest,
      adapterReady,
    });
    return { ...result, runId };
  }
  if (result.code !== 0) {
    patchRun(cfg.outDir, "train", runId, {
      status: "failed",
      pid: null,
      exitCode: result.code,
      lastCheckpoint: latest ? path.basename(latest) : null,
      resumeFrom: latest,
      adapterReady,
      error: `llamafactory-cli 退出码 ${result.code}`,
    });
    return { ...result, runId };
  }
  patchRun(cfg.outDir, "train", runId, {
    status: "completed",
    pid: null,
    exitCode: 0,
    error: null,
    lastCheckpoint: adapterReady ? "final" : latest ? path.basename(latest) : null,
    adapterReady,
  });
  return { ...result, runId };
}

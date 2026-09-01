import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { patchTrainYaml } from "./trainYaml.js";
import type { ResolvedConfig } from "./types.js";

export interface TrainRunOptions {
  yamlPath: string;
  cwd?: string;
  bin?: string;
  extraArgs?: string[];
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

export function resolveLlamaFactoryBin(explicit?: string): string | null {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const env = process.env.LLAMAFACTORY_BIN;
  if (env && fs.existsSync(env)) return env;
  return null;
}

const DEFAULT_YAML = `### model
model_name_or_path: Qwen/Qwen2.5-0.5B-Instruct
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
template: qwen
cutoff_len: 1024
max_samples: 100000
overwrite_cache: true
preprocessing_num_workers: 4

### output
output_dir: ./outputs/train
logging_steps: 10
save_steps: 200
plot_loss: true
overwrite_output_dir: true

### train
per_device_train_batch_size: 1
gradient_accumulation_steps: 8
learning_rate: 1.0e-4
num_train_epochs: 2.0
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
  const bin = opts.bin || process.env.LLAMAFACTORY_BIN || "llamafactory-cli";
  const args = ["train", opts.yamlPath, ...(opts.extraArgs ?? [])];
  opts.onLog?.(`$ ${bin} ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, PYTHONUTF8: "1" },
      shell: process.platform === "win32",
    });

    const onAbort = (): void => {
      child.kill();
    };
    opts.signal?.addEventListener("abort", onAbort);

    child.stdout?.on("data", (buf: Buffer) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) opts.onLog?.(line);
      }
    });
    child.stderr?.on("data", (buf: Buffer) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) opts.onLog?.(line);
      }
    });
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
  bin?: string;
  patch?: Record<string, string | number | boolean>;
}

/** 写出 dataset_info + yaml，再 spawn llamafactory-cli train。 */
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

export async function startTrainFromConfig(
  cfg: ResolvedConfig,
  opts: StartTrainOptions = {},
): Promise<{ code: number; cancelled: boolean }> {
  if (!fs.existsSync(cfg.paths.sft)) {
    throw new Error(`没有训练集 ${cfg.paths.sft}，请先在「数据生成」页或执行 mtrain generate`);
  }
  const { yamlPath } = prepareTrainFiles(cfg, opts.patch);
  return runTrain({
    yamlPath,
    cwd: cfg.root,
    bin: opts.bin,
    signal: opts.signal,
    onLog: opts.onLog,
  });
}

/**
 * 用 LlamaFactory 对评估集做 batch predict（do_predict），再转成 {id, pred}。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { applyModelHubEnv, looksLikeHfModelDir, parseModelHub } from "./modelSource.js";
import {
  decodeSubprocessBuffer,
  detectLlamaFactory,
  trainChildEnv,
  trainSpawnSpec,
} from "./llamaFactoryEnv.js";
import { parseTrainYaml, yamlScalar } from "./trainYaml.js";
import type { InferFlags, PredictionRow, ResolvedConfig, SftExample } from "./types.js";
import { readJsonOrJsonl, writeJsonl } from "./jsonl.js";

export function looksLikeLoraAdapter(dir: string): boolean {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return ["adapter_config.json", "adapter_model.safetensors", "adapter_model.bin"].some((name) =>
    fs.existsSync(path.join(dir, name)),
  );
}

export function lfPredsToRows(
  golds: SftExample[],
  lfRows: Array<{ predict?: string; prediction?: string }>,
): PredictionRow[] {
  return golds.map((gold, i) => ({
    id: gold.id ?? i,
    pred: String(lfRows[i]?.predict ?? lfRows[i]?.prediction ?? "").trim(),
  }));
}

function posixRel(from: string, to: string): string {
  const rel = path.relative(from, to).replaceAll("\\", "/");
  return rel || path.basename(to);
}

export function upsertDatasetEntry(dir: string, name: string, dataFile: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const infoPath = path.join(dir, "dataset_info.json");
  let info: Record<string, unknown> = {};
  if (fs.existsSync(infoPath)) {
    try {
      info = JSON.parse(fs.readFileSync(infoPath, "utf8")) as Record<string, unknown>;
    } catch {
      info = {};
    }
  }
  info[name] = {
    file_name: path.isAbsolute(dataFile) ? posixRel(dir, dataFile) : dataFile,
    formatting: "alpaca",
    columns: {
      prompt: "instruction",
      query: "input",
      response: "output",
    },
  };
  fs.writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`, "utf8");
}

export function writePredictYaml(opts: {
  file: string;
  model: string;
  adapter?: string | null;
  template: string;
  datasetDir: string;
  outputDir: string;
  cutoffLen: number;
}): string {
  const lora = Boolean(opts.adapter && looksLikeLoraAdapter(opts.adapter));
  const lines = [
    "### model",
    `model_name_or_path: ${yamlScalar(opts.model)}`,
    ...(lora && opts.adapter ? [`adapter_name_or_path: ${yamlScalar(opts.adapter.replaceAll("\\", "/"))}`] : []),
    "trust_remote_code: true",
    "",
    "### method",
    "stage: sft",
    "do_predict: true",
    `finetuning_type: ${lora ? "lora" : "full"}`,
    "",
    "### dataset",
    "eval_dataset: term_eval",
    `dataset_dir: ${yamlScalar(opts.datasetDir.replaceAll("\\", "/"))}`,
    `template: ${yamlScalar(opts.template)}`,
    `cutoff_len: ${opts.cutoffLen}`,
    "overwrite_cache: true",
    "preprocessing_num_workers: 4",
    "",
    "### output",
    `output_dir: ${yamlScalar(opts.outputDir.replaceAll("\\", "/"))}`,
    "overwrite_output_dir: true",
    "report_to: none",
    "",
    "### eval",
    "per_device_eval_batch_size: 1",
    "predict_with_generate: true",
    "max_new_tokens: 256",
    "ddp_timeout: 180000000",
    "",
  ];
  fs.mkdirSync(path.dirname(opts.file), { recursive: true });
  fs.writeFileSync(opts.file, `${lines.join("\n")}\n`, "utf8");
  return opts.file;
}

function findGeneratedPreds(dir: string): string | null {
  const direct = path.join(dir, "generated_predictions.jsonl");
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir)) {
    const nested = path.join(dir, name, "generated_predictions.jsonl");
    if (fs.existsSync(nested)) return nested;
  }
  return null;
}

function emit(buf: Buffer, onLog?: (line: string) => void): void {
  for (const line of decodeSubprocessBuffer(buf).split(/\r?\n/)) {
    if (line.trim()) onLog?.(line);
  }
}

async function runPredictYaml(
  cfg: ResolvedConfig,
  yamlPath: string,
  flags: InferFlags,
): Promise<void> {
  const detect = detectLlamaFactory({ home: flags.home ?? cfg.lfHome, bin: flags.bin ?? cfg.lfBin });
  if (!detect.ok) throw new Error(detect.errors.join("\n"));
  const spec = trainSpawnSpec(detect, yamlPath);
  const hub = parseModelHub(flags.hub) ?? cfg.lfHub;
  const onLog = flags.onLog ?? ((line: string) => console.log(line));
  onLog(`$ ${spec.command} ${spec.args.join(" ")}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: cfg.root,
      env: applyModelHubEnv(trainChildEnv(detect), {
        hub,
        hfEndpoint: flags.hfEndpoint ?? cfg.lfHfEndpoint,
        cacheDir: cfg.lfModelCacheDir,
      }),
      shell: spec.shell,
      windowsHide: true,
    });
    const onAbort = (): void => {
      child.kill();
    };
    flags.signal?.addEventListener("abort", onAbort);
    child.stdout?.on("data", (buf: Buffer) => emit(buf, onLog));
    child.stderr?.on("data", (buf: Buffer) => emit(buf, onLog));
    child.on("error", (err) => {
      flags.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      flags.signal?.removeEventListener("abort", onAbort);
      if (flags.signal?.aborted) {
        reject(new Error("已停止"));
        return;
      }
      if (code !== 0) {
        reject(new Error(`LlamaFactory 预测退出码 ${code}`));
        return;
      }
      resolve();
    });
  });
}

export async function inferLlamaFactorySlice(
  cfg: ResolvedConfig,
  goldFile: string,
  predFile: string,
  flags: InferFlags,
): Promise<string> {
  const golds = readJsonOrJsonl<SftExample>(goldFile);
  if (!golds.length) throw new Error(`评估集为空: ${goldFile}`);
  const datasetDir = cfg.paths.evalLf;
  const evalCopy = path.join(datasetDir, "term_eval.jsonl");
  writeJsonl(evalCopy, golds);
  upsertDatasetEntry(datasetDir, "term_eval", evalCopy);

  const yamlPath = cfg.trainConfig;
  const knobs = yamlPath && fs.existsSync(yamlPath) ? parseTrainYaml(fs.readFileSync(yamlPath, "utf8")) : {};
  const adapterRaw = (flags.adapter || cfg.trainOutputDir || "").trim();
  if (!adapterRaw) {
    throw new Error("没有可加载的模型。请选择一次训练实验。");
  }
  const adapterDir = path.isAbsolute(adapterRaw) ? adapterRaw : path.resolve(cfg.root, adapterRaw);
  const lora = looksLikeLoraAdapter(adapterDir);
  const full = looksLikeHfModelDir(adapterDir);
  const model =
    (flags.model && !lora ? flags.model : "") ||
    (lora ? String(knobs.model_name_or_path ?? "") : "") ||
    (full ? adapterDir.replaceAll("\\", "/") : "") ||
    String(knobs.model_name_or_path ?? "");
  if (!model) {
    throw new Error("没有可加载的模型。请先完成训练（实验目录 ckpt 里应有 adapter），或在训练页填写基座模型。");
  }
  const outDir = cfg.paths.lfPredict;
  const predictYaml = cfg.paths.predictYaml;
  writePredictYaml({
    file: predictYaml,
    model,
    adapter: lora ? adapterDir : null,
    template: String(knobs.template ?? "qwen"),
    datasetDir,
    outputDir: outDir,
    cutoffLen: Number(knobs.cutoff_len ?? 1024) || 1024,
  });
  const onLog = flags.onLog ?? ((line: string) => console.log(line));
  onLog(`[infer] LlamaFactory 预测 n=${golds.length} gold=${goldFile}`);
  if (lora) onLog(`[infer] LoRA: ${adapterDir}`);
  else onLog(`[infer] 未找到 adapter，将按完整模型加载: ${model}`);
  await runPredictYaml(cfg, predictYaml, flags);
  const gen = findGeneratedPreds(outDir);
  if (!gen) {
    throw new Error(`预测完成但没有 generated_predictions.jsonl（目录 ${outDir}）`);
  }
  const lfRows = readJsonOrJsonl<{ predict?: string; prediction?: string }>(gen);
  writeJsonl(predFile, lfPredsToRows(golds, lfRows));
  onLog(`[infer] backend=llamafactory n=${golds.length} -> ${predFile}`);
  return predFile;
}

/**
 * 读取 LlamaFactory / HuggingFace Trainer 验证结束后写出的指标 JSON。
 * 不调推理接口。常见文件：trainer_state.json、all_results.json、eval_results.json、
 * train_results.json、trainer_log.jsonl。
 */
import fs from "node:fs";
import path from "node:path";
import { isRecord } from "./util.js";

export interface LfLogPoint {
  step: number;
  epoch: number | null;
  loss: number | null;
  eval_loss: number | null;
  learning_rate: number | null;
}

export interface LfPredSample {
  input: string;
  predict: string;
  label: string;
}

export interface LfSnapshot {
  dir: string;
  files: string[];
  train_loss: number | null;
  eval_loss: number | null;
  first_eval_loss: number | null;
  min_eval_loss: number | null;
  min_eval_step: number | null;
  last_eval_loss: number | null;
  epoch: number | null;
  global_step: number | null;
  best_metric: number | null;
  best_checkpoint: string | null;
  gap: number | null;
  log: LfLogPoint[];
  extras: Record<string, number>;
  n_pred: number;
  exact_match: number | null;
  copy_input_rate: number | null;
  empty_rate: number | null;
  repeat_rate: number | null;
  length_ratio: number | null;
  mean_pred_chars: number | null;
  mean_label_chars: number | null;
  bleu4: number | null;
  rouge1: number | null;
  rouge2: number | null;
  rougel: number | null;
  samples: LfPredSample[];
}

function emptySnap(dir: string): LfSnapshot {
  return {
    dir,
    files: [],
    train_loss: null,
    eval_loss: null,
    first_eval_loss: null,
    min_eval_loss: null,
    min_eval_step: null,
    last_eval_loss: null,
    epoch: null,
    global_step: null,
    best_metric: null,
    best_checkpoint: null,
    gap: null,
    log: [],
    extras: {},
    n_pred: 0,
    exact_match: null,
    copy_input_rate: null,
    empty_rate: null,
    repeat_rate: null,
    length_ratio: null,
    mean_pred_chars: null,
    mean_label_chars: null,
    bleu4: null,
    rouge1: null,
    rouge2: null,
    rougel: null,
    samples: [],
  };
}

function normText(text: string): string {
  return String(text || "")
    .replace(/\s+/g, "")
    .trim();
}

function extractInput(prompt: string): string {
  const tagged = prompt.match(/输入句子为[：:]([\s\S]*?)(?:<\|im_end\|>|$)/);
  if (tagged?.[1]) return tagged[1].trim();
  const user = prompt.match(/<\|im_start\|>user\n([\s\S]*?)<\|im_end\|>/);
  return (user?.[1] || "").trim();
}

function isRepeat(pred: string): boolean {
  const t = normText(pred);
  if (t.length < 12) return false;
  const half = Math.floor(t.length / 2);
  return t.slice(0, half) === t.slice(half, half * 2);
}

function loadPredictions(file: string, snap: LfSnapshot): void {
  const rows = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { prompt?: string; predict?: string; label?: string; prediction?: string });
  if (!rows.length) return;
  let exact = 0;
  let copy = 0;
  let empty = 0;
  let repeat = 0;
  let predChars = 0;
  let labelChars = 0;
  const fails: LfPredSample[] = [];
  for (const row of rows) {
    const predict = String(row.predict ?? row.prediction ?? "");
    const label = String(row.label ?? "");
    const input = extractInput(String(row.prompt ?? ""));
    predChars += normText(predict).length;
    labelChars += normText(label).length;
    if (!predict.trim()) empty += 1;
    if (normText(predict) === normText(label)) exact += 1;
    else if (fails.length < 8) {
      fails.push({
        input: input.slice(0, 120),
        predict: predict.slice(0, 120),
        label: label.slice(0, 120),
      });
    }
    if (input && normText(predict) === normText(input)) copy += 1;
    if (isRepeat(predict)) repeat += 1;
  }
  const n = rows.length;
  snap.n_pred = n;
  snap.exact_match = +(exact / n).toFixed(4);
  snap.copy_input_rate = +(copy / n).toFixed(4);
  snap.empty_rate = +(empty / n).toFixed(4);
  snap.repeat_rate = +(repeat / n).toFixed(4);
  snap.mean_pred_chars = +(predChars / n).toFixed(1);
  snap.mean_label_chars = +(labelChars / n).toFixed(1);
  snap.length_ratio = labelChars > 0 ? +(predChars / labelChars).toFixed(3) : null;
  snap.samples = fails;
}

function pullPredictScores(snap: LfSnapshot): void {
  const x = snap.extras;
  snap.bleu4 = x["predict_bleu-4"] ?? x.predict_bleu4 ?? x["eval_bleu-4"] ?? null;
  snap.rouge1 = x["predict_rouge-1"] ?? x["eval_rouge-1"] ?? null;
  snap.rouge2 = x["predict_rouge-2"] ?? x["eval_rouge-2"] ?? null;
  snap.rougel = x["predict_rouge-l"] ?? x["eval_rouge-l"] ?? null;
}

function asNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asStr(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function readJsonFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function flattenNumbers(obj: unknown, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(obj)) return out;
  for (const [key, value] of Object.entries(obj)) {
    const name = prefix ? `${prefix}.${key}` : key;
    const n = asNum(value);
    if (n != null) out[name] = n;
    else if (isRecord(value) && !Array.isArray(value)) Object.assign(out, flattenNumbers(value, name));
  }
  return out;
}

function parseLogEntry(row: unknown): LfLogPoint | null {
  if (!isRecord(row)) return null;
  const loss = asNum(row.loss);
  const evalLoss = asNum(row.eval_loss ?? row.eval_loss_value);
  const step = asNum(row.step ?? row.current_steps) ?? 0;
  if (loss == null && evalLoss == null) return null;
  return {
    step,
    epoch: asNum(row.epoch),
    loss,
    eval_loss: evalLoss,
    learning_rate: asNum(row.learning_rate ?? row.lr),
  };
}

function loadTrainerState(file: string, snap: LfSnapshot): void {
  const raw = readJsonFile(file);
  if (!isRecord(raw)) return;
  snap.epoch = snap.epoch ?? asNum(raw.epoch);
  snap.global_step = snap.global_step ?? asNum(raw.global_step);
  snap.best_metric = asNum(raw.best_metric);
  snap.best_checkpoint = asStr(raw.best_model_checkpoint);
  const history = Array.isArray(raw.log_history) ? raw.log_history : [];
  for (const item of history) {
    const point = parseLogEntry(item);
    if (point) snap.log.push(point);
  }
}

function loadResultsJson(file: string, snap: LfSnapshot): void {
  const raw = readJsonFile(file);
  Object.assign(snap.extras, flattenNumbers(raw));
  if (!isRecord(raw)) return;
  snap.epoch = snap.epoch ?? asNum(raw.epoch);
  snap.eval_loss = snap.eval_loss ?? asNum(raw.eval_loss);
  snap.train_loss = snap.train_loss ?? asNum(raw.train_loss);
}

function loadTrainerLog(file: string, snap: LfSnapshot): void {
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const point = parseLogEntry(JSON.parse(line));
      if (point) snap.log.push(point);
    } catch {
      /* 跳过坏行 */
    }
  }
}

function finalize(snap: LfSnapshot): LfSnapshot {
  snap.log.sort((a, b) => a.step - b.step || (a.epoch ?? 0) - (b.epoch ?? 0));
  const trainPoints = snap.log.map((p) => p.loss).filter((n): n is number => n != null);
  const evalPoints = snap.log
    .map((p) => ({ loss: p.eval_loss, step: p.step }))
    .filter((p): p is { loss: number; step: number } => p.loss != null);

  if (snap.train_loss == null && trainPoints.length) snap.train_loss = trainPoints[trainPoints.length - 1]!;
  if (evalPoints.length) {
    snap.first_eval_loss = evalPoints[0]!.loss;
    snap.last_eval_loss = evalPoints[evalPoints.length - 1]!.loss;
    let min = evalPoints[0]!;
    for (const p of evalPoints) if (p.loss < min.loss) min = p;
    snap.min_eval_loss = min.loss;
    snap.min_eval_step = min.step;
    snap.eval_loss = snap.eval_loss ?? snap.last_eval_loss;
  }
  if (snap.eval_loss == null && snap.extras.eval_loss != null) snap.eval_loss = snap.extras.eval_loss;
  if (snap.train_loss == null && snap.extras.train_loss != null) snap.train_loss = snap.extras.train_loss;
  if (snap.train_loss != null && snap.eval_loss != null) snap.gap = snap.eval_loss - snap.train_loss;
  return snap;
}

const NAMES = [
  "trainer_state.json",
  "all_results.json",
  "eval_results.json",
  "predict_results.json",
  "train_results.json",
  "trainer_log.jsonl",
  "eval_results.jsonl",
  "generated_predictions.jsonl",
] as const;

/** 从一个 output_dir 或单个 json 文件抽出训练/验证指标。 */
export function loadLfMetrics(target: string): LfSnapshot {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) throw new Error(`找不到 LlamaFactory 指标路径: ${resolved}`);

  const snap = emptySnap(resolved);

  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    snap.files.push(path.basename(resolved));
    const base = path.basename(resolved).toLowerCase();
    if (base === "generated_predictions.jsonl") loadPredictions(resolved, snap);
    else if (base.endsWith(".jsonl")) loadTrainerLog(resolved, snap);
    else if (base.includes("trainer_state")) loadTrainerState(resolved, snap);
    else loadResultsJson(resolved, snap);
    snap.dir = path.dirname(resolved);
    pullPredictScores(snap);
    return finalize(snap);
  }

  for (const name of NAMES) {
    const file = path.join(resolved, name);
    if (!fs.existsSync(file)) continue;
    snap.files.push(name);
    if (name === "trainer_state.json") loadTrainerState(file, snap);
    else if (name === "generated_predictions.jsonl") loadPredictions(file, snap);
    else if (name.endsWith(".jsonl")) loadTrainerLog(file, snap);
    else loadResultsJson(file, snap);
  }

  const ckpts = fs
    .readdirSync(resolved, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^checkpoint-\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => Number(a.slice(11)) - Number(b.slice(11)));
  const lastCkpt = ckpts[ckpts.length - 1];
  if (lastCkpt && !snap.files.includes("trainer_state.json")) {
    const nested = path.join(resolved, lastCkpt, "trainer_state.json");
    if (fs.existsSync(nested)) {
      snap.files.push(`${lastCkpt}/trainer_state.json`);
      loadTrainerState(nested, snap);
    }
  }

  if (!snap.files.length) {
    throw new Error(
      `${resolved} 里没有 all_results.json / predict_results.json / generated_predictions.jsonl / trainer_state.json。请指向 LlamaFactory 验证或预测的输出目录。`,
    );
  }
  pullPredictScores(snap);
  return finalize(snap);
}

export function rankingScore(snap: LfSnapshot): { score: number; breakdown: Record<string, number> } {
  const bleu = (snap.bleu4 ?? 0) / 100;
  const rouge = (snap.rougel ?? snap.rouge1 ?? 0) / 100;
  const exact = snap.exact_match ?? 0;
  const copy = snap.copy_input_rate ?? 0;
  if (snap.bleu4 != null || snap.rougel != null || snap.n_pred) {
    const score = 0.35 * rouge + 0.25 * bleu + 0.25 * exact + 0.15 * (1 - copy);
    return {
      score: +score.toFixed(6),
      breakdown: { rouge_l: rouge, bleu4: bleu, exact_match: exact, copy_input: copy },
    };
  }
  const loss = snap.eval_loss ?? snap.min_eval_loss ?? snap.train_loss;
  if (loss == null) return { score: Number.NEGATIVE_INFINITY, breakdown: {} };
  return { score: +(-loss).toFixed(6), breakdown: { eval_loss: loss } };
}

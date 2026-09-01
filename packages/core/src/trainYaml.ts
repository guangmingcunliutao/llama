/**
 * 读写 LlamaFactory 风格的扁平 YAML（key: value），用来快照训练超参并写出下一轮建议。
 */
import type { TrainKnobs } from "./types.js";

export const TRAIN_KEYS = [
  "model_name_or_path",
  "finetuning_type",
  "lora_rank",
  "lora_alpha",
  "lora_dropout",
  "lora_target",
  "learning_rate",
  "num_train_epochs",
  "lr_scheduler_type",
  "warmup_ratio",
  "per_device_train_batch_size",
  "gradient_accumulation_steps",
  "cutoff_len",
  "output_dir",
  "template",
  "bf16",
] as const;

export type TrainKey = (typeof TRAIN_KEYS)[number];

export type { TrainKnobs };

const KEY_SET = new Set<string>(TRAIN_KEYS);

function coerce(raw: string): string | number | boolean | null {
  const value = raw.replace(/#.*$/, "").trim();
  if (value === "null" || value === "~" || value === "") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseTrainYaml(text: string): TrainKnobs {
  const knobs: Record<string, string | number | boolean | null> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1]!;
    if (!KEY_SET.has(key)) continue;
    knobs[key] = coerce(match[2] ?? "");
  }
  return knobs as TrainKnobs;
}

export function yamlScalar(value: string | number | boolean | null): string {
  if (value == null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value) && Math.abs(value) > 0 && Math.abs(value) < 0.01) {
      return value.toExponential(1);
    }
    return String(value);
  }
  return value;
}

export function asNumber(knobs: Record<string, unknown>, key: string, fallback: number): number {
  const value = knobs[key];
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 只改已有键的值，保留注释和其余字段。 */
export function patchTrainYaml(text: string, patch: Record<string, string | number | boolean>): string {
  const applied = new Set<string>();
  const lines = text.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*?)\s*$/);
    if (!match) return line;
    const key = match[1]!;
    if (!(key in patch)) return line;
    applied.add(key);
    return `${key}: ${yamlScalar(patch[key]!)}`;
  });
  const missing = Object.entries(patch).filter(([key]) => !applied.has(key));
  if (!missing.length) return `${lines.join("\n").replace(/\s*$/, "")}\n`;
  const extra = ["", "### analyze 建议追加", ...missing.map(([k, v]) => `${k}: ${yamlScalar(v)}`)];
  return `${lines.join("\n").replace(/\s*$/, "")}\n${extra.join("\n")}\n`;
}

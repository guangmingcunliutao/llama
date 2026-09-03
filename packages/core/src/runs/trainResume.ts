import fs from "node:fs";
import path from "node:path";

export function findLatestCheckpoint(ckptDir: string): string | null {
  if (!fs.existsSync(ckptDir)) return null;
  const names = fs
    .readdirSync(ckptDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^checkpoint-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => Number(a.slice(11)) - Number(b.slice(11)));
  const last = names[names.length - 1];
  return last ? path.join(ckptDir, last) : null;
}

const RESUME_LOCK_KEYS = [
  "model_name_or_path",
  "lora_rank",
  "lora_alpha",
  "lora_target",
  "cutoff_len",
  "per_device_train_batch_size",
  "gradient_accumulation_steps",
  "learning_rate",
  "num_train_epochs",
  "max_steps",
  "lr_scheduler_type",
  "warmup_ratio",
] as const;

function sameKnob(
  stored: string | number | boolean,
  next: string | number | boolean,
): boolean {
  if (String(stored) === String(next)) return true;
  const a = Number(stored);
  const b = Number(next);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

export function resumeBlockedReason(
  stored: Record<string, string | number | boolean>,
  next: Record<string, string | number | boolean>,
): string | null {
  for (const key of RESUME_LOCK_KEYS) {
    if (next[key] == null) continue;
    if (stored[key] == null) continue;
    if (!sameKnob(stored[key], next[key])) {
      return `超参 ${key} 已改变，不能从中断处继续，请全新训练或基于上次再训练`;
    }
  }
  return null;
}

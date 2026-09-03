import fs from "node:fs";
import path from "node:path";
import { findLatestCheckpoint } from "./trainResume.js";

export function hasLoraAdapter(dir: string): boolean {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return ["adapter_config.json", "adapter_model.safetensors", "adapter_model.bin"].some((name) =>
    fs.existsSync(path.join(dir, name)),
  );
}

/** 成品目录或最新 checkpoint 里的 LoRA。 */
export function resolveLoraAdapterDir(ckptDir: string): string | null {
  if (hasLoraAdapter(ckptDir)) return ckptDir;
  const latest = findLatestCheckpoint(ckptDir);
  if (latest && hasLoraAdapter(latest)) return latest;
  return null;
}

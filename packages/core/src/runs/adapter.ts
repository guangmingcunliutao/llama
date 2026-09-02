import fs from "node:fs";
import path from "node:path";

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

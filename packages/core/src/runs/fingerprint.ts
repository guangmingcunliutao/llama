import { createHash } from "node:crypto";
import fs from "node:fs";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

export function fingerprintValue(value: unknown): string {
  const hash = createHash("sha256");
  hash.update(stableStringify(value));
  return `sha256:${hash.digest("hex")}`;
}

export function fingerprintFile(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(file));
  return `sha256:${hash.digest("hex")}`;
}

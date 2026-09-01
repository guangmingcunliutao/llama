import fs from "node:fs";
import path from "node:path";

/** 读 jsonl；文件不存在时按 `missing` 处理。 */
export function readJsonl<T>(file: string, missing: "throw" | "empty" = "throw"): T[] {
  if (!fs.existsSync(file)) {
    if (missing === "empty") return [];
    throw new Error(`文件不存在: ${file}`);
  }
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

export function readJsonOrJsonl<T>(file: string): T[] {
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".jsonl")) {
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as T);
  }
  const data: unknown = JSON.parse(text);
  if (Array.isArray(data)) return data as T[];
  if (data !== null && typeof data === "object" && "samples" in data) {
    const samples = (data as { samples?: unknown }).samples;
    if (Array.isArray(samples)) return samples as T[];
  }
  return [];
}

export function countJsonl(file: string): number {
  return readJsonl(file, "empty").length;
}

export function writeJsonl(file: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(file, body + (rows.length ? "\n" : ""), "utf8");
}

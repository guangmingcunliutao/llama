import fs from "node:fs";
import path from "node:path";
import type { RunKind } from "./types.js";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function slugifyLabel(label: string): string {
  const ascii = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return ascii || "run";
}

export function timestampId(now = new Date()): string {
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function allocateRunId(outDir: string, kind: RunKind, label: string, now = new Date()): string {
  const base = `${timestampId(now)}-${slugifyLabel(label)}`;
  const root = path.join(outDir, kind);
  let id = base;
  let n = 2;
  while (fs.existsSync(path.join(root, id))) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

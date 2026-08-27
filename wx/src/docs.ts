import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "./config.js";

const SPLIT_SLICES_MD = "split-slices.md";

export function splitSlicesTemplatePath(): string {
  return path.join(packageRoot(), "templates", SPLIT_SLICES_MD);
}

/** 把评估切片说明写到目标目录（init / split 后调用）。 */
export function writeSplitSlicesDoc(destDir: string): string {
  const src = splitSlicesTemplatePath();
  if (!fs.existsSync(src)) return "";
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, SPLIT_SLICES_MD);
  fs.copyFileSync(src, dest);
  return dest;
}

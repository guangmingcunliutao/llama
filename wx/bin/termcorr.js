#!/usr/bin/env node
/**
 * 命令名 `termcorr` 的入口（package.json bin）。
 * 逻辑在打包后的 dist/cli.js，启动时会自己执行 main。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const distCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
if (!fs.existsSync(distCli)) {
  console.error("未找到 dist/cli.js。请先在 wx 目录执行: pnpm install && pnpm build");
  process.exit(1);
}

await import(pathToFileURL(distCli).href);

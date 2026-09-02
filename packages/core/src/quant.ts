/**
 * 用本机 llama.cpp 工具做 GGUF 量化。
 * 工具目录可以是官方运行包、Llama.app，或 llama.cpp 源码/编译目录。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { JobCancelledError, throwIfAborted } from "./abort.js";
import { killProcessTree } from "./killTree.js";
import { decodeSubprocessBuffer, detectLlamaFactory, findSystemPython } from "./llamaFactoryEnv.js";
import { looksLikeHfModelDir } from "./modelSource.js";
import { hasLoraAdapter } from "./runs/adapter.js";
import { loadWorkspace } from "./runs/store.js";
import { trainRunPaths } from "./runs/paths.js";
import type { ResolvedConfig } from "./types.js";

export interface QuantDetect {
  quantize: string | null;
  convert: string | null;
  python: string | null;
  ok: boolean;
  notes: string[];
}

export interface QuantizeFlags {
  source: string;
  formats: string[];
  dtype?: string;
  requant?: boolean;
  keepMid?: boolean;
  llamaHome?: string | null;
  llamaQuantize?: string | null;
  convertScript?: string | null;
  outDir?: string | null;
  trainRunId?: string | null;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

const WIN = process.platform === "win32";
const QUANTIZE_NAMES = WIN ? ["llama-quantize.exe", "llama-quantize"] : ["llama-quantize"];
const CONVERT_NAMES = ["convert_hf_to_gguf.py"];

function isFile(file: string): boolean {
  try {
    return fs.existsSync(file) && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDir(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function emit(buf: Buffer, onLog?: (line: string) => void): void {
  for (const line of decodeSubprocessBuffer(buf).split(/\r?\n/)) {
    if (line.trim()) onLog?.(line);
  }
}

function firstExisting(files: string[]): string | null {
  for (const file of files) {
    if (isFile(file)) return file;
  }
  return null;
}

function asHome(raw: string): string {
  const resolved = path.resolve(raw.trim());
  return isFile(resolved) ? path.dirname(resolved) : resolved;
}

function quantizeCandidates(home: string): string[] {
  const dirs = [
    home,
    path.join(home, "bin"),
    path.join(home, "build", "bin"),
    path.join(home, "Contents", "MacOS"),
    path.join(home, "Contents", "Resources"),
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    for (const name of QUANTIZE_NAMES) files.push(path.join(dir, name));
  }
  return files;
}

function findQuantizeInHome(home: string): string | null {
  const hit = firstExisting(quantizeCandidates(home));
  if (hit) return hit;
  try {
    const names = fs.readdirSync(home).slice(0, 40);
    for (const name of names) {
      const child = path.join(home, name);
      if (!isDir(child)) continue;
      const nested = firstExisting(quantizeCandidates(child));
      if (nested) return nested;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 从 llama.cpp 运行包 / Llama.app / 源码目录解析 llama-quantize。 */
export function resolveLlamaQuantize(raw?: string | null): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const resolved = path.resolve(text);
  if (isFile(resolved)) return resolved;
  if (isDir(resolved)) return findQuantizeInHome(resolved);
  return null;
}

export function resolveConvertScript(raw?: string | null): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const resolved = path.resolve(text);
  if (isFile(resolved)) return resolved;
  if (isDir(resolved)) {
    return findConvertNear(resolved);
  }
  return null;
}

/** 在工具目录及其相邻 llama.cpp 源码里找 convert_hf_to_gguf.py。 */
export function findConvertNear(homeRaw?: string | null): string | null {
  const text = (homeRaw ?? "").trim();
  if (!text) return null;
  const home = asHome(text);
  const roots = [home, path.dirname(home), path.join(path.dirname(home), "llama.cpp"), path.join(home, "llama.cpp")];
  const files: string[] = [];
  for (const root of roots) {
    for (const name of CONVERT_NAMES) {
      files.push(path.join(root, name));
      files.push(path.join(root, "scripts", name));
    }
  }
  return firstExisting(files);
}

function whichSync(command: string): string | null {
  const finder = WIN ? "where" : "which";
  const result = spawnSync(finder, [command], { encoding: "utf8", shell: false, windowsHide: true });
  if (result.status !== 0) return null;
  const line = (result.stdout || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.toLowerCase().includes("info:"));
  return line && isFile(line) ? line : line || null;
}

export function detectQuantTools(
  opts: {
    llamaHome?: string | null;
    llamaQuantize?: string | null;
    convertScript?: string | null;
    lfHome?: string | null;
  } = {},
): QuantDetect {
  const notes: string[] = [];
  const quantize =
    resolveLlamaQuantize(opts.llamaHome) ||
    resolveLlamaQuantize(opts.llamaQuantize) ||
    whichSync("llama-quantize") ||
    whichSync("llama-quantize.exe");
  const convert =
    resolveConvertScript(opts.convertScript) ||
    findConvertNear(opts.llamaHome) ||
    findConvertNear(opts.llamaQuantize);
  const python = findSystemPython() || detectLlamaFactory({ home: opts.lfHome }).python;
  if (quantize) notes.push(`量化工具：${quantize}`);
  else {
    notes.push(
      "未找到 llama-quantize。请把官方运行包、Llama.app 或 llama.cpp 编译目录拷到本机，并在设置里填写该目录。不要用聊天用的 llama.exe。",
    );
  }
  if (convert) notes.push(`HF 转换脚本：${convert}`);
  else {
    notes.push(
      "当前目录没有 convert_hf_to_gguf.py。已有 GGUF 仍可量化；若源是 HuggingFace 目录，请另给一份 llama.cpp 源码（或单独填写该脚本）并安装系统 Python。",
    );
  }
  if (python) notes.push(`Python：${python}`);
  else notes.push("未找到可用 Python。HF 转 GGUF 需要 Python 3.10+，不要用 Microsoft Store 占位的 python.exe。");
  return { quantize, convert, python, ok: Boolean(quantize), notes };
}

function runChild(opts: {
  command: string;
  args: string[];
  cwd?: string;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}): Promise<void> {
  throwIfAborted(opts.signal);
  opts.onLog?.(`$ ${opts.command} ${opts.args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
    const onAbort = (): void => {
      killProcessTree(child);
      setTimeout(() => killProcessTree(child), 300);
    };
    opts.signal?.addEventListener("abort", onAbort);
    if (opts.signal?.aborted) onAbort();
    child.stdout?.on("data", (buf: Buffer) => emit(buf, opts.onLog));
    child.stderr?.on("data", (buf: Buffer) => emit(buf, opts.onLog));
    child.on("error", (err) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(opts.signal?.aborted ? new JobCancelledError() : err);
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) {
        reject(new JobCancelledError());
        return;
      }
      if ((code ?? 1) !== 0) {
        reject(new Error(`${path.basename(opts.command)} 退出码 ${code}`));
        return;
      }
      resolve();
    });
  });
}

function parseFormats(flags: QuantizeFlags): string[] {
  const fromList = flags.formats.map((item) => item.trim()).filter(Boolean);
  return [...new Set(fromList.length ? fromList : ["Q4_K_M"])];
}

function stemName(source: string): string {
  const base = path.basename(source).replace(/\.gguf$/i, "");
  return base || "model";
}

export async function quantizeSource(cfg: ResolvedConfig, flags: QuantizeFlags): Promise<string> {
  throwIfAborted(flags.signal);
  const tools = detectQuantTools({
    llamaHome: flags.llamaHome,
    llamaQuantize: flags.llamaQuantize ?? cfg.quantBin,
    convertScript: flags.convertScript ?? cfg.quantConvertScript,
    lfHome: cfg.lfHome,
  });
  if (!tools.quantize) {
    throw new Error(tools.notes.join("\n"));
  }
  const source = path.resolve(cfg.root, flags.source);
  if (!fs.existsSync(source)) throw new Error(`源路径不存在：${source}`);
  if (hasLoraAdapter(source)) {
    throw new Error("这是 LoRA adapter 目录，不能直接量化。请先用 LlamaFactory export 合并成完整模型，或提供已有 GGUF。");
  }

  const ws = loadWorkspace(cfg.outDir);
  const trainId = flags.trainRunId || ws.trainRunId;
  const outDir = flags.outDir
    ? path.resolve(cfg.root, flags.outDir)
    : trainId
      ? trainRunPaths(cfg.outDir, trainId).quant
      : path.join(cfg.outDir, "quant");
  fs.mkdirSync(outDir, { recursive: true });

  const st = fs.statSync(source);
  let gguf = source;
  let mid: string | null = null;
  if (st.isDirectory()) {
    if (!looksLikeHfModelDir(source)) {
      throw new Error("目录里没有 config.json / 权重，不像 HuggingFace 模型。请填合并后的模型目录或 .gguf 文件。");
    }
    if (!tools.convert) {
      throw new Error(
        "HuggingFace 目录需要 convert_hf_to_gguf.py。官方 Windows 运行包通常不含该脚本。请改填已有 .gguf，或把 llama.cpp 源码目录一并拷过来（或单独填写脚本路径）。",
      );
    }
    if (!tools.python) {
      throw new Error("HF 转 GGUF 需要系统 Python 3.10+，不要使用 Microsoft Store 占位的 python.exe。");
    }
    const dtype = flags.dtype && ["f16", "bf16", "f32"].includes(flags.dtype) ? flags.dtype : "f16";
    mid = path.join(outDir, `${stemName(source)}-${dtype}.gguf`);
    flags.onLog?.(`[quant] HF → ${dtype} GGUF`);
    await runChild({
      command: tools.python,
      args: [tools.convert, source, "--outfile", mid, "--outtype", dtype],
      cwd: cfg.root,
      signal: flags.signal,
      onLog: flags.onLog,
    });
    gguf = mid;
  } else if (!source.toLowerCase().endsWith(".gguf")) {
    throw new Error("请填写 .gguf 文件或 HuggingFace 模型目录");
  }

  const types = parseFormats(flags);
  for (const type of types) {
    throwIfAborted(flags.signal);
    const output = path.join(outDir, `${stemName(gguf)}-${type}.gguf`);
    const args = flags.requant ? ["--allow-requantize", gguf, output, type] : [gguf, output, type];
    flags.onLog?.(`[quant] ${path.basename(gguf)} → ${type}`);
    await runChild({
      command: tools.quantize,
      args,
      cwd: cfg.root,
      signal: flags.signal,
      onLog: flags.onLog,
    });
  }

  if (mid && flags.keepMid !== true && !types.map((t) => t.toLowerCase()).includes("f16") && fs.existsSync(mid)) {
    try {
      fs.unlinkSync(mid);
      flags.onLog?.(`[quant] 已删除中间文件 ${mid}`);
    } catch {
      /* keep */
    }
  }
  flags.onLog?.(`[quant] 写出 ${outDir}`);
  return outDir;
}

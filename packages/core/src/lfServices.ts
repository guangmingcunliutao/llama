/**
 * 按需拉起本机 LlamaFactory WebUI 与 SwanLab 离线看板。
 * 已在监听则复用，不重复 spawn。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  detectLlamaFactory,
  trainChildEnv,
  webuiSpawnSpec,
  type LlamaFactoryDetect,
} from "./llamaFactoryEnv.js";
import { ensureLlamaFactoryCompat } from "./llamaFactoryCompat.js";
import { killPidTree, pidAlive } from "./killTree.js";

function metaDir(outDir: string): string {
  return path.join(outDir, "lf-meta");
}

export interface EnsureServiceResult {
  url: string;
  started: boolean;
  already: boolean;
  pid: number | null;
  logFile: string | null;
  hint?: string;
}

interface PidRecord {
  pid: number;
  url: string;
  logDir?: string;
}

function readPid(file: string): PidRecord | null {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PidRecord>;
    if (typeof raw.pid !== "number") return null;
    return { pid: raw.pid, url: String(raw.url ?? "") };
  } catch {
    return null;
  }
}

function writePid(file: string, rec: PidRecord): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, "utf8");
}

export async function probeHttp(url: string, timeoutMs = 2000): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: "manual" });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntilUp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeHttp(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return probeHttp(url);
}

function bindHost(): string {
  const host = (process.env.GRADIO_SERVER_NAME || process.env.MODEL_TRAINING_HOST || "127.0.0.1").trim();
  if (host === "0.0.0.0" || host === "::") return host;
  return host || "127.0.0.1";
}

function portOf(url: string, fallback: number): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return fallback;
  }
}

function spawnLogged(
  spec: { command: string; args: string[]; shell: boolean },
  env: NodeJS.ProcessEnv,
  logFile: string,
  cwd?: string | null,
): number {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logFd = fs.openSync(logFile, "a");
  const child = spawn(spec.command, spec.args, {
    env,
    cwd: cwd || undefined,
    detached: true,
    windowsHide: true,
    shell: spec.shell,
    stdio: ["ignore", logFd, logFd],
  });
  if (child.pid == null) {
    fs.closeSync(logFd);
    throw new Error(`无法启动 ${spec.command}`);
  }
  child.unref();
  fs.closeSync(logFd);
  return child.pid;
}

function findSwanlabSpec(detect: LlamaFactoryDetect): { command: string; prefix: string[] } | null {
  const names =
    process.platform === "win32" ? ["swanlab.exe", "swanlab.cmd", "swanlab"] : ["swanlab"];
  if (detect.bin) {
    const dir = path.dirname(detect.bin);
    for (const name of names) {
      const hit = path.join(dir, name);
      if (fs.existsSync(hit)) return { command: hit, prefix: [] };
    }
  }
  if (detect.python) return { command: detect.python, prefix: ["-m", "swanlab"] };
  return null;
}

export async function ensureLlamaFactoryWebui(opts: {
  home?: string | null;
  bin?: string | null;
  outDir: string;
  url?: string;
}): Promise<EnsureServiceResult> {
  const url = opts.url || process.env.LLAMAFACTORY_WEBUI_URL || "http://127.0.0.1:7860";
  const pidFile = path.join(metaDir(opts.outDir), "webui.pid.json");
  const logFile = path.join(metaDir(opts.outDir), "webui.log");
  const detectEarly = detectLlamaFactory({ home: opts.home, bin: opts.bin });
  // 换机器/新装 LF：启动前幂等补齐兼容项，不依赖手改过的源码拷贝。
  if (detectEarly.ok) {
    ensureLlamaFactoryCompat(detectEarly);
    ensureSwanlabLogJunction({ outDir: opts.outDir, home: detectEarly.home });
  }

  if (await probeHttp(url)) {
    return { url, started: false, already: true, pid: readPid(pidFile)?.pid ?? null, logFile };
  }
  const rec = readPid(pidFile);
  if (rec && pidAlive(rec.pid)) {
    const ok = await waitUntilUp(url, 90_000);
    if (!ok) throw new Error(`LlamaFactory WebUI 进程 ${rec.pid} 已在跑，但 ${url} 仍打不开。看 ${logFile}`);
    return { url, started: false, already: true, pid: rec.pid, logFile };
  }
  const detect = detectEarly.ok ? detectEarly : detectLlamaFactory({ home: opts.home, bin: opts.bin });
  if (!detect.ok) throw new Error(detect.errors.join("\n") || "未找到 LlamaFactory，请在设置里填写安装目录");
  ensureLlamaFactoryCompat(detect);
  const swanDir = ensureSwanlabLogJunction({ outDir: opts.outDir, home: detect.home });
  const spec = webuiSpawnSpec(detect);
  const port = String(portOf(url, 7860));
  const env = trainChildEnv(detect, {
    GRADIO_SERVER_NAME: bindHost(),
    GRADIO_SERVER_PORT: port,
    SWANLAB_LOGDIR: swanDir,
    SWANLAB_MODE: "local",
  });
  const pid = spawnLogged(spec, env, logFile, detect.home);
  writePid(pidFile, { pid, url });
  const ok = await waitUntilUp(url, 90_000);
  if (!ok) {
    throw new Error(`已启动 LlamaFactory WebUI（pid ${pid}），但 90 秒内 ${url} 仍无响应。看 ${logFile}`);
  }
  return { url, started: true, already: false, pid, logFile };
}

export function swanlabLogDir(outDir: string): string {
  return path.join(outDir, "swanlog");
}

/**
 * LF 默认把 local 日志写到 cwd/swanlog（即 LlamaFactory/swanlog）。
 * 本仓库约定在 outputs/swanlog；用目录联接把两者指到同一处，避免看板空、训练有日志。
 */
export function ensureSwanlabLogJunction(opts: { outDir: string; home?: string | null }): string {
  const target = swanlabLogDir(opts.outDir);
  fs.mkdirSync(target, { recursive: true });
  const home = (opts.home || "").trim();
  if (!home || process.platform !== "win32") return target;
  const link = path.join(path.resolve(home), "swanlog");
  if (path.resolve(link) === path.resolve(target)) return target;
  try {
    if (fs.existsSync(link)) {
      const st = fs.lstatSync(link);
      if (st.isSymbolicLink() || isJunction(link)) {
        try {
          if (path.resolve(fs.realpathSync(link)) === path.resolve(target)) return target;
        } catch {
          /* fall through */
        }
      }
      if (st.isDirectory() && !st.isSymbolicLink() && !isJunction(link)) {
        mergeCopyDir(link, target);
        const srcCount = countEntries(link);
        const destHas = srcCount === 0 || countEntries(target) > 0;
        if (!destHas) {
          throw new Error(`复制 swanlog 失败，保留原目录 ${link}`);
        }
        fs.rmSync(link, { recursive: true, force: true });
      }
    }
    if (!fs.existsSync(link)) {
      fs.symlinkSync(target, link, "junction");
    }
  } catch (err) {
    console.warn(`[swanlab] 无法联接 ${link} -> ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return target;
}

function countEntries(dir: string): number {
  try {
    return fs.readdirSync(dir).length;
  } catch {
    return 0;
  }
}

function isJunction(p: string): boolean {
  try {
    // Windows junction：lstat 为目录且 realpath 与自身不同，或 readlink 成功
    const linked = fs.readlinkSync(p);
    return Boolean(linked);
  } catch {
    return false;
  }
}

function mergeCopyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dest = path.join(to, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      if (!fs.existsSync(dest)) {
        fs.cpSync(src, dest, { recursive: true });
      }
    } else if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
}

export async function ensureSwanLabWatch(opts: {
  home?: string | null;
  bin?: string | null;
  outDir: string;
  url?: string;
}): Promise<EnsureServiceResult> {
  const url = opts.url || process.env.SWANLAB_WATCH_URL || "http://127.0.0.1:5092";
  const detect = detectLlamaFactory({ home: opts.home, bin: opts.bin });
  if (detect.ok) ensureLlamaFactoryCompat(detect);
  const logDir = ensureSwanlabLogJunction({
    outDir: opts.outDir,
    home: detect.ok ? detect.home : opts.home,
  });
  const pidFile = path.join(metaDir(opts.outDir), "swanlab.pid.json");
  const logFile = path.join(metaDir(opts.outDir), "swanlab.log");
  const hint =
    "Extra 勾选 SwanLab，mode=local 即可。日志已对齐到下方目录（WebUI 无需再填 logdir）。训练开始后刷新看板。不上云、不需要 API Key。";

  const rec = readPid(pidFile);
  const sameDir = rec?.logDir ? path.resolve(rec.logDir) === path.resolve(logDir) : false;
  if (sameDir && rec && pidAlive(rec.pid) && (await probeHttp(url))) {
    return { url, started: false, already: true, pid: rec.pid, logFile, hint };
  }
  if (rec && pidAlive(rec.pid)) {
    killPidTree(rec.pid);
    await new Promise((r) => setTimeout(r, 800));
  } else if (await probeHttp(url)) {
    // 端口被占用但不是我们记录的进程：仍尝试按 pid 文件清理
    if (rec?.pid) killPidTree(rec.pid);
  }

  const found = detect.ok ? findSwanlabSpec(detect) : null;
  if (!found) {
    throw new Error(
      `未找到 swanlab。在 LlamaFactory 虚拟环境执行 pip install "swanlab[dashboard]" 后再打开。看板地址 ${url}`,
    );
  }
  const port = String(portOf(url, 5092));
  const args = [
    ...found.prefix,
    "watch",
    "-h",
    bindHost() === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1",
    "-p",
    port,
    "-l",
    logDir,
  ];
  const lower = found.command.toLowerCase();
  const shell = lower.endsWith(".cmd") || lower.endsWith(".bat");
  const env = detect.ok
    ? trainChildEnv(detect, { SWANLAB_MODE: "local", SWANLAB_LOGDIR: logDir })
    : { ...process.env, SWANLAB_MODE: "local", SWANLAB_LOGDIR: logDir };
  const pid = spawnLogged({ command: found.command, args, shell }, env, logFile, detect.ok ? detect.home : undefined);
  writePid(pidFile, { pid, url, logDir });
  const ok = await waitUntilUp(url, 30_000);
  if (!ok) {
    throw new Error(
      `已启动 SwanLab watch（pid ${pid}），但 ${url} 仍无响应。没有训练日志时看板也可能是空页。看 ${logFile}`,
    );
  }
  return { url, started: true, already: false, pid, logFile, hint };
}

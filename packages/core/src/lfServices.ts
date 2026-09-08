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
import { pidAlive } from "./killTree.js";

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
  if (await probeHttp(url)) {
    return { url, started: false, already: true, pid: readPid(pidFile)?.pid ?? null, logFile };
  }
  const rec = readPid(pidFile);
  if (rec && pidAlive(rec.pid)) {
    const ok = await waitUntilUp(url, 90_000);
    if (!ok) throw new Error(`LlamaFactory WebUI 进程 ${rec.pid} 已在跑，但 ${url} 仍打不开。看 ${logFile}`);
    return { url, started: false, already: true, pid: rec.pid, logFile };
  }
  const detect = detectLlamaFactory({ home: opts.home, bin: opts.bin });
  if (!detect.ok) throw new Error(detect.errors.join("\n") || "未找到 LlamaFactory，请在设置里填写安装目录");
  const spec = webuiSpawnSpec(detect);
  const port = String(portOf(url, 7860));
  const env = trainChildEnv(detect, {
    GRADIO_SERVER_NAME: bindHost(),
    GRADIO_SERVER_PORT: port,
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

export async function ensureSwanLabWatch(opts: {
  home?: string | null;
  bin?: string | null;
  outDir: string;
  url?: string;
}): Promise<EnsureServiceResult> {
  const url = opts.url || process.env.SWANLAB_WATCH_URL || "http://127.0.0.1:5092";
  const logDir = swanlabLogDir(opts.outDir);
  fs.mkdirSync(logDir, { recursive: true });
  const pidFile = path.join(metaDir(opts.outDir), "swanlab.pid.json");
  const logFile = path.join(metaDir(opts.outDir), "swanlab.log");
  const hint =
    "在 LlamaFactory 训练页 Extra 勾选 SwanLab，mode=local，日志目录填本页给出的 swanlab 路径。开始训练后刷新看板即有曲线。不上云、不需要 API Key。";
  if (await probeHttp(url)) {
    return { url, started: false, already: true, pid: readPid(pidFile)?.pid ?? null, logFile, hint };
  }
  const rec = readPid(pidFile);
  if (rec && pidAlive(rec.pid)) {
    const ok = await waitUntilUp(url, 30_000);
    if (!ok) throw new Error(`SwanLab 进程 ${rec.pid} 已在跑，但 ${url} 仍打不开。看 ${logFile}`);
    return { url, started: false, already: true, pid: rec.pid, logFile, hint };
  }
  const detect = detectLlamaFactory({ home: opts.home, bin: opts.bin });
  const found = detect.ok ? findSwanlabSpec(detect) : null;
  if (!found) {
    throw new Error(
      `未找到 swanlab。在 LlamaFactory 虚拟环境执行 pip install "swanlab[dashboard]" 后再打开。看板地址 ${url}`,
    );
  }
  const port = String(portOf(url, 5092));
  const args = [...found.prefix, "watch", "-h", bindHost() === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1", "-p", port, "-l", logDir];
  const lower = found.command.toLowerCase();
  const shell = lower.endsWith(".cmd") || lower.endsWith(".bat");
  const env = detect.ok
    ? trainChildEnv(detect, { SWANLAB_MODE: "local" })
    : { ...process.env, SWANLAB_MODE: "local" };
  const pid = spawnLogged({ command: found.command, args, shell }, env, logFile, detect.home);
  writePid(pidFile, { pid, url });
  const ok = await waitUntilUp(url, 30_000);
  if (!ok) {
    throw new Error(
      `已启动 SwanLab watch（pid ${pid}），但 ${url} 仍无响应。没有训练日志时看板也可能是空页。看 ${logFile}`,
    );
  }
  return { url, started: true, already: false, pid, logFile, hint };
}

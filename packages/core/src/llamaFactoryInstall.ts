/**
 * 安装 LlamaFactory：优先执行 @model-training/core/scripts/install-llamafactory.sh。
 * LlamaFactory 源码与 finetune 虚拟环境写到数据仓库根（INSTALL_ROOT），不写进包目录。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { throwIfAborted, JobCancelledError } from "./abort.js";
import { packageRoot } from "./config.js";
import {
  decodeSubprocessBuffer,
  detectLlamaFactory,
  findBash,
  findGit,
  findSystemPython,
  looksLikeLlamaFactoryHome,
} from "./llamaFactoryEnv.js";

const REPO = "https://github.com/hiyouga/LlamaFactory.git";

export interface InstallLlamaFactoryOptions {
  /** 数据仓库根，作为 INSTALL_ROOT（LlamaFactory/ 与 finetune/ 落在这里） */
  scriptRoot?: string;
  home?: string;
  torchCuda?: string;
  pipIndexUrl?: string;
  pythonVersion?: string;
  branch?: string;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

function dirEmpty(dir: string): boolean {
  if (!fs.existsSync(dir)) return true;
  return fs.readdirSync(dir).filter((name) => name !== "." && name !== "..").length === 0;
}

function emit(buf: Buffer, onLog?: (line: string) => void): void {
  for (const line of decodeSubprocessBuffer(buf).split(/\r?\n/)) {
    if (line.trim()) onLog?.(line);
  }
}

function run(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; onLog?: (line: string) => void },
): Promise<void> {
  throwIfAborted(opts.signal);
  opts.onLog?.(`$ ${command} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        ...opts.env,
      },
      shell: false,
      windowsHide: true,
    });
    const onAbort = (): void => {
      child.kill();
    };
    opts.signal?.addEventListener("abort", onAbort);
    child.stdout?.on("data", (buf: Buffer) => emit(buf, opts.onLog));
    child.stderr?.on("data", (buf: Buffer) => emit(buf, opts.onLog));
    child.on("error", (err) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) {
        reject(new JobCancelledError());
        return;
      }
      if (code !== 0) {
        reject(new Error(`${path.basename(command)} 退出码 ${code}`));
        return;
      }
      resolve();
    });
  });
}

function venvPython(home: string): string {
  return process.platform === "win32"
    ? path.join(home, ".venv", "Scripts", "python.exe")
    : path.join(home, ".venv", "bin", "python");
}

export function locateInstallScript(): string | null {
  const bundled = path.join(packageRoot(), "scripts", "install-llamafactory.sh");
  return fs.existsSync(bundled) ? bundled : null;
}

async function runInstallScript(
  script: string,
  opts: InstallLlamaFactoryOptions,
): Promise<{ home: string }> {
  const bash = findBash();
  if (!bash) {
    throw new Error("未找到 bash。安装脚本需要 Git Bash 或 WSL。");
  }
  const installRoot = path.resolve(opts.scriptRoot || process.cwd());
  opts.onLog?.(`执行 ${script}`);
  opts.onLog?.(`INSTALL_ROOT=${installRoot}（LlamaFactory/ 与 finetune/）`);
  const uvCache = path.join(installRoot, ".cache", "uv");
  const uvPython = path.join(installRoot, ".cache", "uv-python");
  fs.mkdirSync(uvCache, { recursive: true });
  fs.mkdirSync(uvPython, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    INSTALL_ROOT: installRoot,
    UV_CACHE_DIR: uvCache,
    UV_PYTHON_INSTALL_DIR: uvPython,
  };
  if (opts.torchCuda) env.TORCH_CUDA = opts.torchCuda;
  if (opts.pipIndexUrl) env.PIP_INDEX_URL = opts.pipIndexUrl;
  if (opts.pythonVersion) env.PYTHON_VERSION = opts.pythonVersion;
  if (opts.branch) env.LLAMAFACTORY_BRANCH = opts.branch;
  await run(bash, [script], { cwd: installRoot, env, signal: opts.signal, onLog: opts.onLog });
  const home = path.join(installRoot, "LlamaFactory");
  const detect = detectLlamaFactory({ home, bin: null });
  if (!detect.ok) {
    throw new Error(detect.errors.join("\n"));
  }
  opts.onLog?.("安装完成，可以开始训练。");
  return { home };
}

async function installByClone(opts: InstallLlamaFactoryOptions): Promise<{ home: string }> {
  const home = path.resolve((opts.home ?? "").trim());
  if (!home) throw new Error("请填写 LlamaFactory 安装目录");
  const python = findSystemPython();
  if (!python) {
    throw new Error("未找到可用 Python。请先安装 Python 3.10+，不要使用 Microsoft Store 占位的 python.exe。");
  }
  opts.onLog?.(`使用 Python: ${python}`);

  const exists = fs.existsSync(home);
  if (exists && !dirEmpty(home) && !looksLikeLlamaFactoryHome(home)) {
    throw new Error(`目录已有其它文件，不能安装到: ${home}`);
  }

  if (!exists || dirEmpty(home)) {
    const git = findGit();
    if (!git) throw new Error("未找到 git。请先安装 Git 后再克隆 LLaMA-Factory。");
    fs.mkdirSync(path.dirname(home), { recursive: true });
    if (exists && dirEmpty(home)) {
      await run(git, ["clone", "--depth", "1", REPO, "."], { cwd: home, signal: opts.signal, onLog: opts.onLog });
    } else {
      await run(git, ["clone", "--depth", "1", REPO, home], { signal: opts.signal, onLog: opts.onLog });
    }
  } else {
    opts.onLog?.("目录已是 LlamaFactory 仓库，跳过克隆。");
  }

  const py = venvPython(home);
  if (!fs.existsSync(py)) {
    await run(python, ["-m", "venv", path.join(home, ".venv")], {
      cwd: home,
      signal: opts.signal,
      onLog: opts.onLog,
    });
  } else {
    opts.onLog?.("已有虚拟环境，跳过 venv。");
  }

  await run(py, ["-m", "pip", "install", "-U", "pip"], { cwd: home, signal: opts.signal, onLog: opts.onLog });
  await run(py, ["-m", "pip", "install", "-e", "."], { cwd: home, signal: opts.signal, onLog: opts.onLog });
  opts.onLog?.("未找到安装脚本，已用 python -m venv 兜底。GPU 版 PyTorch 请自行安装。");

  const detect = detectLlamaFactory({ home, bin: null });
  if (!detect.ok) {
    throw new Error(detect.errors.join("\n"));
  }
  opts.onLog?.("安装完成，可以开始训练。");
  return { home };
}

export async function installLlamaFactory(opts: InstallLlamaFactoryOptions): Promise<{ home: string }> {
  const script = locateInstallScript();
  if (script) return runInstallScript(script, opts);
  return installByClone(opts);
}

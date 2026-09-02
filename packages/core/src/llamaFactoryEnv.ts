/**
 * 定位本机 LlamaFactory，并解码 Windows 子进程输出（避免 GBK 当 UTF-8 读出乱码）。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface LlamaFactoryDetect {
  ok: boolean;
  home: string | null;
  python: string | null;
  bin: string | null;
  /** python -m llamafactory.cli 或 cli 可执行文件 */
  mode: "module" | "cli" | null;
  errors: string[];
  notes: string[];
}

function existsFile(file: string): boolean {
  try {
    return fs.existsSync(file) && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function existsDir(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isStorePythonStub(file: string): boolean {
  const lower = file.toLowerCase();
  return lower.includes("\\windowsapps\\") || lower.includes("/windowsapps/");
}

function pickPython(file: string | null): string | null {
  if (!file || isStorePythonStub(file)) return null;
  return file;
}

function win(): boolean {
  return process.platform === "win32";
}

function pythonNames(): string[] {
  return win() ? ["python.exe", "python"] : ["python3", "python"];
}

function cliNames(): string[] {
  return win()
    ? ["llamafactory-cli.exe", "llamafactory-cli.cmd", "llamafactory-cli"]
    : ["llamafactory-cli"];
}

function joinIfFile(dir: string, name: string): string | null {
  const file = path.join(dir, name);
  return existsFile(file) ? file : null;
}

function venvBinDirs(home: string): string[] {
  const names = [".venv", "venv", "finetune"];
  const bins = win() ? ["Scripts", "bin"] : ["bin", "Scripts"];
  const dirs: string[] = [];
  for (const base of [home, path.dirname(home)]) {
    for (const name of names) {
      for (const bin of bins) {
        dirs.push(path.join(base, name, bin));
      }
    }
  }
  dirs.push(path.join(home, "bin"), home);
  return dirs;
}

function pythonInHome(home: string): string | null {
  for (const dir of venvBinDirs(home)) {
    for (const name of pythonNames()) {
      const hit = joinIfFile(dir, name);
      if (hit) return hit;
    }
  }
  return null;
}

function cliInHome(home: string): string | null {
  for (const dir of venvBinDirs(home)) {
    for (const name of cliNames()) {
      const hit = joinIfFile(dir, name);
      if (hit) return hit;
    }
  }
  return null;
}

export function looksLikeLlamaFactoryHome(home: string): boolean {
  return (
    existsDir(path.join(home, "src", "llamafactory")) ||
    existsFile(path.join(home, "src", "train.py")) ||
    existsFile(path.join(home, "pyproject.toml"))
  );
}

function whichOnPath(command: string): string | null {
  const finder = win() ? "where" : "which";
  const result = spawnSync(finder, [command], { encoding: "utf8", shell: false, windowsHide: true });
  if (result.status !== 0) return null;
  const line = (result.stdout || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.toLowerCase().includes("info:"));
  if (!line) return null;
  if (command.toLowerCase().startsWith("python") && isStorePythonStub(line)) return null;
  return existsFile(line) ? line : line;
}

function moduleImportOk(python: string, extraPath?: string): boolean {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
  if (extraPath) env.PYTHONPATH = extraPath;
  const result = spawnSync(python, ["-c", "import llamafactory"], {
    encoding: "utf8",
    env,
    timeout: 15000,
    windowsHide: true,
  });
  return result.status === 0;
}

export function findSystemPython(): string | null {
  return pickPython(whichOnPath("python") || whichOnPath("python3"));
}

export function findGit(): string | null {
  return whichOnPath("git") || whichOnPath("git.exe");
}

export function findBash(): string | null {
  const hit = whichOnPath("bash") || whichOnPath("bash.exe");
  if (hit) return hit;
  if (!win()) return null;
  for (const file of [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ]) {
    if (existsFile(file)) return file;
  }
  return null;
}

export function detectLlamaFactory(opts: { home?: string | null; bin?: string | null }): LlamaFactoryDetect {
  const errors: string[] = [];
  const notes: string[] = [];
  const homeRaw = (opts.home || process.env.LLAMAFACTORY_HOME || "").trim();
  const binRaw = (opts.bin || process.env.LLAMAFACTORY_BIN || "").trim();
  const home = homeRaw ? path.resolve(homeRaw) : null;

  if (home && !existsDir(home)) {
    errors.push(`LlamaFactory 目录不存在: ${home}`);
    return { ok: false, home, python: null, bin: binRaw || null, mode: null, errors, notes };
  }

  let python = home ? pickPython(pythonInHome(home)) : null;
  if (!python) python = pickPython(whichOnPath("python") || whichOnPath("python3"));

  let bin = binRaw && existsFile(binRaw) ? binRaw : binRaw ? path.resolve(binRaw) : null;
  if (bin && !existsFile(bin)) {
    errors.push(`指定的 llamafactory-cli 不存在: ${bin}`);
    bin = null;
  }
  if (!bin && home) bin = cliInHome(home);
  if (!bin) {
    const onPath = whichOnPath("llamafactory-cli") || whichOnPath("llamafactory-cli.exe");
    if (onPath) bin = onPath;
  }

  const src = home ? path.join(home, "src") : null;
  const srcOk = Boolean(src && existsDir(path.join(src, "llamafactory")));

  if (python && moduleImportOk(python, srcOk && src ? src : undefined)) {
    if (home && !looksLikeLlamaFactoryHome(home) && !srcOk) {
      notes.push("已能 import llamafactory；目录可以不是官方仓库根，只要虚拟环境装了该包。");
    }
    return {
      ok: true,
      home,
      python,
      bin,
      mode: "module",
      errors,
      notes,
    };
  }

  if (bin) {
    notes.push("将直接调用 llamafactory-cli。建议同时填写含虚拟环境的 LlamaFactory 目录。");
    return { ok: true, home, python, bin, mode: "cli", errors, notes };
  }

  if (!home) {
    errors.push("未找到 LlamaFactory。请在训练页或设置里填写安装目录（含 src/llamafactory 或 .venv）。");
  } else if (!python) {
    errors.push(`目录 ${home} 下没有 Python（期望 .venv、venv 或旁边的 finetune 虚拟环境）。`);
  } else {
    errors.push(`Python 无法 import llamafactory: ${python}。请在该目录创建虚拟环境并 pip install -e .`);
  }
  return { ok: false, home, python, bin, mode: null, errors, notes };
}

export function trainChildEnv(
  detect: LlamaFactoryDetect,
  extra?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONLEGACYWINDOWSSTDIO: "0",
    ...extra,
  };
  if (detect.home && existsDir(path.join(detect.home, "src", "llamafactory"))) {
    env.PYTHONPATH = path.join(detect.home, "src");
  }
  return env;
}

export function trainSpawnSpec(
  detect: LlamaFactoryDetect,
  yamlPath: string,
): { command: string; args: string[]; shell: boolean } {
  const yaml = path.resolve(yamlPath);
  if (detect.mode === "module" && detect.python) {
    return { command: detect.python, args: ["-m", "llamafactory.cli", "train", yaml], shell: false };
  }
  if (detect.bin) {
    const lower = detect.bin.toLowerCase();
    const shell = lower.endsWith(".cmd") || lower.endsWith(".bat");
    return { command: detect.bin, args: ["train", yaml], shell };
  }
  throw new Error("LlamaFactory 环境未就绪");
}

/** 子进程字节：优先 UTF-8，非法序列则按系统中文编码解读。 */
export function decodeSubprocessBuffer(buf: Buffer): string {
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("gb18030").decode(buf);
  } catch {
    return utf8;
  }
}

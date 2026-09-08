/**
 * 手动启动 SwanLab 离线看板（默认 127.0.0.1:5092，日志 outputs/swanlog）。
 * 优先用 LlamaFactory/.venv 里的 swanlab。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lfHome = process.env.LLAMAFACTORY_HOME
  ? path.resolve(process.env.LLAMAFACTORY_HOME)
  : path.join(root, "LlamaFactory");
const logDir = process.env.SWANLAB_LOGDIR
  ? path.resolve(process.env.SWANLAB_LOGDIR)
  : path.join(root, "outputs", "swanlog");
const host = process.env.SWANLAB_HOST || "127.0.0.1";
const port = process.env.SWANLAB_PORT || "5092";
const win = process.platform === "win32";
const venvBin = path.join(lfHome, ".venv", win ? "Scripts" : "bin");
const python = path.join(venvBin, win ? "python.exe" : "python");
const swanNames = win ? ["swanlab.exe", "swanlab.cmd", "swanlab"] : ["swanlab"];

fs.mkdirSync(logDir, { recursive: true });

function pickSwan() {
  for (const name of swanNames) {
    const hit = path.join(venvBin, name);
    if (fs.existsSync(hit)) return { command: hit, args: [], shell: win && hit.toLowerCase().endsWith(".cmd") };
  }
  if (fs.existsSync(python)) {
    return { command: python, args: ["-m", "swanlab"], shell: false };
  }
  return { command: "swanlab", args: [], shell: win };
}

const found = pickSwan();
const args = [...found.args, "watch", "-h", host, "-p", String(port), "-l", logDir];
const env = { ...process.env, SWANLAB_MODE: "local", PYTHONUTF8: "1" };

console.log(`[swanlab:watch] ${found.command} ${args.join(" ")}`);
console.log(`[swanlab:watch] http://${host}:${port}`);
console.log(`[swanlab:watch] logdir=${logDir}`);

const child = spawn(found.command, args, {
  cwd: root,
  env,
  stdio: "inherit",
  shell: found.shell,
  windowsHide: true,
});
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

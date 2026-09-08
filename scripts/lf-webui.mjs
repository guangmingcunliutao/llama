/**
 * 手动启动 LlamaFactory WebUI（默认 127.0.0.1:7860）。
 * 优先用仓库旁 LlamaFactory/.venv，否则走 PATH 上的 llamafactory-cli。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lfHome = process.env.LLAMAFACTORY_HOME
  ? path.resolve(process.env.LLAMAFACTORY_HOME)
  : path.join(root, "LlamaFactory");
const win = process.platform === "win32";
const venvBin = path.join(lfHome, ".venv", win ? "Scripts" : "bin");
const python = path.join(venvBin, win ? "python.exe" : "python");
const cliNames = win
  ? ["llamafactory-cli.exe", "llamafactory-cli.cmd", "llamafactory-cli"]
  : ["llamafactory-cli"];

const env = {
  ...process.env,
  GRADIO_SERVER_NAME: process.env.GRADIO_SERVER_NAME || "127.0.0.1",
  GRADIO_SERVER_PORT: process.env.GRADIO_SERVER_PORT || "7860",
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
};

function pickCli() {
  for (const name of cliNames) {
    const hit = path.join(venvBin, name);
    if (fs.existsSync(hit)) return hit;
  }
  return null;
}

const cli = pickCli();
let command;
let args;
let shell = false;

if (cli) {
  command = cli;
  args = ["webui"];
  shell = win && cli.toLowerCase().endsWith(".cmd");
} else if (fs.existsSync(python)) {
  command = python;
  args = ["-m", "llamafactory.cli", "webui"];
  if (fs.existsSync(path.join(lfHome, "src", "llamafactory"))) {
    env.PYTHONPATH = path.join(lfHome, "src");
  }
} else {
  console.error(
    `未找到 LlamaFactory CLI。请确认 ${lfHome} 下有 .venv，或设置 LLAMAFACTORY_HOME，或把 llamafactory-cli 加入 PATH。`,
  );
  process.exit(1);
}

console.log(`[lf:webui] ${command} ${args.join(" ")}`);
console.log(`[lf:webui] http://${env.GRADIO_SERVER_NAME}:${env.GRADIO_SERVER_PORT}`);
const child = spawn(command, args, { cwd: lfHome, env, stdio: "inherit", shell, windowsHide: true });
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

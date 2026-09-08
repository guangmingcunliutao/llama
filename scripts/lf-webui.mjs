/**
 * 手动启动 LlamaFactory WebUI（默认 127.0.0.1:7860）。
 * 与数据页「打开 LlamaFactory」同一套探测：.venv / venv / 旁路 finetune、配置里的 home/bin。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectLlamaFactory, loadUserConfig, webuiSpawnSpec } from "../packages/core/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const cfg = await loadUserConfig({ command: "status", cwd: root });
const home = cfg.lfHome || path.join(root, "LlamaFactory");
const detect = detectLlamaFactory({ home, bin: cfg.lfBin });
if (!detect.ok) {
  console.error(detect.errors.join("\n") || "未找到 LlamaFactory CLI。");
  console.error("请确认 LlamaFactory 旁有 .venv / venv / finetune，或设置 LLAMAFACTORY_HOME / 配置 llamafactory.home。");
  process.exit(1);
}

const spec = webuiSpawnSpec(detect);
const env = {
  ...process.env,
  GRADIO_SERVER_NAME: process.env.GRADIO_SERVER_NAME || "127.0.0.1",
  GRADIO_SERVER_PORT: process.env.GRADIO_SERVER_PORT || "7860",
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
};
if (detect.home && fs.existsSync(path.join(detect.home, "src", "llamafactory"))) {
  env.PYTHONPATH = path.join(detect.home, "src");
}

console.log(`[lf:webui] ${spec.command} ${spec.args.join(" ")}`);
console.log(`[lf:webui] http://${env.GRADIO_SERVER_NAME}:${env.GRADIO_SERVER_PORT}`);
const child = spawn(spec.command, spec.args, {
  cwd: detect.home || root,
  env,
  stdio: "inherit",
  shell: spec.shell,
  windowsHide: true,
});
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

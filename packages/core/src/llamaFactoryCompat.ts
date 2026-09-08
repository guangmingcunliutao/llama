/**
 * LlamaFactory 运行时兼容：不把本仓库绑死在改过的 LF 源码上。
 * 换机器 / 重装 LF 后，只要从本应用拉起 WebUI，会幂等打上必要补丁与启动器。
 */
import fs from "node:fs";
import path from "node:path";
import { ensureWindowsWebuiCliShim, type LlamaFactoryDetect } from "./llamaFactoryEnv.js";

const MARK_CLOUD = "mtrain-compat:swanlab-cloud";

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function writeText(file: string, text: string): void {
  fs.writeFileSync(file, text, "utf8");
}

/** 把 upstream 的硬取 cloud 改成 .get，避免 local 模式 KeyError。 */
export function patchSwanlabCloudKey(home: string): boolean {
  const file = path.join(home, "src", "llamafactory", "webui", "control.py");
  const text = readText(file);
  if (text == null) return false;
  if (text.includes(MARK_CLOUD)) return false;

  const upstream = `            swanlab_link = swanlab_public_config["cloud"]["experiment_url"]`;
  const safeAssign = `            swanlab_link = (swanlab_public_config.get("cloud") or {}).get("experiment_url")`;

  if (text.includes(safeAssign)) {
    writeText(file, text.replace(safeAssign, `            # ${MARK_CLOUD}\n${safeAssign}`));
    return true;
  }
  if (!text.includes(upstream)) {
    console.warn(`[lf-compat] ${file} 未找到 swanlab cloud 硬编码，跳过（可能已升级）`);
    return false;
  }
  writeText(file, text.replace(upstream, `            # ${MARK_CLOUD}\n${safeAssign}`));
  console.log(`[lf-compat] patched ${file} (${MARK_CLOUD})`);
  return true;
}

/** 去掉本仓库曾写入的 SWANLAB_LOGDIR 注入（改用 swanlog 目录联接，避免改 runner）。 */
export function stripSwanlabLogdirRunnerPatch(home: string): boolean {
  const file = path.join(home, "src", "llamafactory", "webui", "runner.py");
  const text = readText(file);
  if (text == null) return false;
  if (!text.includes("SWANLAB_LOGDIR")) return false;
  const next = text.replace(
    /([ \t]*args\["swanlab_mode"\] = get\("train\.swanlab_mode"\))\r?\n(?:[ \t]*#.*\r?\n)?[ \t]*env_logdir = \(os\.environ\.get\("SWANLAB_LOGDIR"\)[^\r\n]*\r?\n[ \t]*if env_logdir:\r?\n[ \t]*args\["swanlab_logdir"\] = env_logdir\r?\n/,
    "$1\n",
  );
  if (next === text) {
    console.warn(`[lf-compat] ${file} 含 SWANLAB_LOGDIR 但未能安全剥离，请手工还原 runner.py`);
    return false;
  }
  writeText(file, next);
  console.log(`[lf-compat] restored upstream runner.py (drop SWANLAB_LOGDIR patch)`);
  return true;
}

/**
 * 对齐 Windows 启动器与已知 WebUI 坑。
 * swanlog 目录联接由 lfServices.ensureSwanlabLogJunction 负责（不改 LF 源码）。
 */
export function ensureLlamaFactoryCompat(detect: LlamaFactoryDetect): {
  shim: string | null;
  patchedCloud: boolean;
  strippedLogdirPatch: boolean;
} {
  const shim = ensureWindowsWebuiCliShim(detect);
  let patchedCloud = false;
  let strippedLogdirPatch = false;
  if (detect.home) {
    patchedCloud = patchSwanlabCloudKey(detect.home);
    strippedLogdirPatch = stripSwanlabLogdirRunnerPatch(detect.home);
  }
  return { shim, patchedCloud, strippedLogdirPatch };
}

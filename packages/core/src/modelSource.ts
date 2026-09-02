/**
 * 基座模型来源：本机目录，或 Hugging Face / ModelScope / 魔乐（OpenMind）仓库 ID。
 * 线上源通过环境变量交给 LlamaFactory / transformers，yaml 里只写 model_name_or_path。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MODEL_HUBS = ["local", "huggingface", "modelscope", "openmind"] as const;
export type ModelHub = (typeof MODEL_HUBS)[number];

export function parseModelHub(value: unknown): ModelHub | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (key === "hf" || key === "huggingface" || key === "hugging_face") return "huggingface";
  if (key === "ms" || key === "modelscope" || key === "model_scope") return "modelscope";
  if (key === "openmind" || key === "modelers" || key === "魔乐") return "openmind";
  if (key === "local" || key === "path" || key === "disk") return "local";
  return null;
}

export function looksLikeLocalModelPath(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (text.startsWith("/") || text.startsWith("~") || text.startsWith("\\\\")) return true;
  if (/^[A-Za-z]:[\\/]/.test(text)) return true;
  return false;
}

export function looksLikeHfModelDir(dir: string): boolean {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return ["config.json", "model.safetensors", "pytorch_model.bin", "tokenizer.json", "tokenizer_config.json"].some(
    (name) => fs.existsSync(path.join(dir, name)),
  );
}

export function resolveUserPath(root: string, value: string): string {
  const text = value.trim();
  if (text.startsWith("~")) {
    return path.resolve(os.homedir(), text.slice(1).replace(/^[\\/]/, ""));
  }
  if (path.isAbsolute(text) || looksLikeLocalModelPath(text)) return path.resolve(text);
  return path.resolve(root, text);
}

export function inferModelHub(model: string, explicit?: ModelHub | null): ModelHub {
  if (looksLikeLocalModelPath(model)) return "local";
  if (explicit === "local") return "local";
  return explicit ?? "modelscope";
}

export function validateModelSource(opts: { root: string; model: string; hub?: ModelHub | string | null }): string | null {
  const model = opts.model.trim();
  if (!model) return "请填写基座模型（本地目录或线上仓库 ID）";
  const hub = inferModelHub(model, parseModelHub(opts.hub));
  if (hub !== "local") {
    if (looksLikeLocalModelPath(model)) {
      return "当前填写的是本地路径，请改选「本地目录」";
    }
    if (!model.includes("/") && !model.includes("\\")) {
      return "线上模型请填写仓库 ID，例如 Qwen/Qwen3-0.6B";
    }
    return null;
  }
  const abs = resolveUserPath(opts.root, model);
  if (!fs.existsSync(abs)) return `本地模型目录不存在: ${abs}`;
  if (!fs.statSync(abs).isDirectory()) return `本地模型必须是目录: ${abs}`;
  if (!looksLikeHfModelDir(abs)) {
    return `目录不像模型权重（未找到 config.json / tokenizer 等）: ${abs}`;
  }
  return null;
}

export function resolvedModelNameOrPath(opts: { root: string; model: string; hub?: ModelHub | null }): string {
  const model = opts.model.trim();
  const hub = inferModelHub(model, opts.hub);
  if (hub === "local") return resolveUserPath(opts.root, model).replaceAll("\\", "/");
  return model;
}

export interface ModelHubEnvOpts {
  hub: ModelHub;
  hfEndpoint?: string | null;
  cacheDir?: string | null;
}

/** 清掉冲突的 Hub 开关后再按所选源设置。 */
export function applyModelHubEnv(env: NodeJS.ProcessEnv, opts: ModelHubEnvOpts): NodeJS.ProcessEnv {
  const next = { ...env };
  delete next.USE_MODELSCOPE_HUB;
  delete next.USE_OPENMIND_HUB;
  if (opts.hub === "modelscope") next.USE_MODELSCOPE_HUB = "1";
  if (opts.hub === "openmind") next.USE_OPENMIND_HUB = "1";
  const endpoint = opts.hfEndpoint?.trim();
  if (opts.hub === "huggingface" && endpoint) next.HF_ENDPOINT = endpoint.replace(/\/+$/, "");
  const cache = opts.cacheDir?.trim();
  if (cache && opts.hub !== "local") {
    if (opts.hub === "modelscope") next.MODELSCOPE_CACHE = cache;
    else if (opts.hub === "openmind") next.OPENMIND_CACHE = cache;
    else {
      next.HF_HOME = cache;
      next.HUGGINGFACE_HUB_CACHE = path.join(cache, "hub");
    }
  }
  return next;
}

export interface FsEntry {
  name: string;
  path: string;
  kind: "dir" | "model";
}

export interface FsListing {
  cwd: string;
  parent: string | null;
  isModel: boolean;
  entries: FsEntry[];
}

export function listFsRoots(): Array<{ name: string; path: string }> {
  if (process.platform === "win32") {
    const roots: Array<{ name: string; path: string }> = [];
    for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZAB") {
      const drive = `${letter}:\\`;
      try {
        if (fs.existsSync(drive) && fs.statSync(drive).isDirectory()) {
          roots.push({ name: `${letter}:`, path: drive });
        }
      } catch {
        /* skip inaccessible */
      }
    }
    const home = os.homedir();
    if (home) roots.unshift({ name: "用户目录", path: home });
    return roots;
  }
  return [
    { name: "根目录", path: "/" },
    { name: "用户目录", path: os.homedir() },
  ];
}

export function listFsDir(dir: string): FsListing {
  const cwd = path.resolve(dir);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`目录不存在: ${cwd}`);
  }
  const parsed = path.parse(cwd);
  const parent = cwd === parsed.root ? null : path.dirname(cwd);
  const names = fs.readdirSync(cwd);
  const entries: FsEntry[] = [];
  for (const name of names) {
    if (name === "." || name === "..") continue;
    const full = path.join(cwd, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    entries.push({
      name,
      path: full,
      kind: looksLikeHfModelDir(full) ? "model" : "dir",
    });
    if (entries.length >= 400) break;
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "model" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
  return { cwd, parent, isModel: looksLikeHfModelDir(cwd), entries };
}

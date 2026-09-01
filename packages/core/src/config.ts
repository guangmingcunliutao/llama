/**
 * 加载工作区配置（Vite 风格）。
 *
 * 在 cwd 或 --config 指定路径查找 model-training.config.{json,ts,...}。
 * 相对路径相对于配置文件目录解析。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyLegacyPeopleOptions, PEOPLE_SEARCH_HTTP } from "./sources/peopleDefaults.js";
import { parseFormats } from "./format.js";
import type {
  HttpSourceOptions,
  InferConfig,
  LocalJsonlSourceOptions,
  ResolvedConfig,
  ResolvedRateConfig,
  ResolvedSource,
  SourceType,
  UserConfig,
  UserConfigExport,
  UserConfigFn,
} from "./types.js";
import { isRecord } from "./util.js";

const DEFAULT_INSTRUCTION =
  "请将句子中的不规范政治表述改正为规范表述，只输出改正后的句子。";

const CONFIG_NAMES = [
  "model-training.config.json",
  "model-training.config.ts",
  "model-training.config.mts",
  "model-training.config.mjs",
  "model-training.config.js",
  "model-training.config.cjs",
] as const;

/**
 * 打包后本文件位于 dist/，仓库根是上一级。
 * 未打包时若用 tsx 直接跑 src/config.ts，则再上一级。
 */
function detectPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "templates", "model-training.config.ts"))) return dir;
    if (fs.existsSync(path.join(dir, "templates", "model-training.config.js"))) return dir;
    const next = path.resolve(dir, "..");
    if (next === dir) break;
    dir = next;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

const PKG_ROOT = detectPackageRoot();

export function packageRoot(): string {
  return PKG_ROOT;
}

/**
 * 给工作区配置做字段提示。运行时原样返回。
 *
 * @example
 * ```ts
 * import { defineConfig } from "@model-training/core";
 * export default defineConfig({ outDir: "./outputs" });
 * ```
 */
export function defineConfig(config: UserConfig): UserConfig;
export function defineConfig(config: UserConfigFn): UserConfigFn;
export function defineConfig(config: UserConfigExport): UserConfigExport {
  return config;
}

/**
 * 读嵌套字段，同时兼容 snake_case 与 camelCase。
 * 运行时配置已规范化，新代码请直接读 ResolvedConfig 字段。
 */
export function get<T>(cfg: object, dotted: string, fallback: T): T {
  const camel = dotted.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
  for (const key of [dotted, camel]) {
    let cur: unknown = cfg;
    let ok = true;
    for (const part of key.split(".")) {
      if (!isRecord(cur) || !(part in cur)) {
        ok = false;
        break;
      }
      cur = cur[part];
    }
    if (ok && cur !== undefined) return cur as T;
  }
  return fallback;
}

export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

export function isInsideDir(parent: string, child: string): boolean {
  const a = path.resolve(parent);
  const b = path.resolve(child);
  return b === a || b.startsWith(a + path.sep);
}

function findConfigFile(cwd: string, explicit?: string): string | null {
  if (explicit) {
    const file = path.isAbsolute(explicit) ? explicit : path.resolve(cwd, explicit);
    if (!fs.existsSync(file)) throw new Error(`找不到配置文件: ${file}`);
    return file;
  }

  const candidates: string[] = [];
  let dir = path.resolve(cwd);
  for (let depth = 0; depth < 6; depth += 1) {
    for (const name of CONFIG_NAMES) {
      candidates.push(path.join(dir, name));
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

async function importConfig(file: string): Promise<unknown> {
  if (file.endsWith(".json")) {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  }
  if (/\.(ts|mts)$/.test(file)) {
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url, {
      interopDefault: true,
      alias: {
        "model-training": path.join(PKG_ROOT, "dist/index.js"),
        "@model-training/core": path.join(PKG_ROOT, "dist/index.js"),
      },
    });
    return jiti(file) as unknown;
  }
  const href = `${pathToFileURL(file).href}?t=${Date.now()}`;
  const mod: unknown = await import(href);
  if (isRecord(mod) && "default" in mod) return mod.default;
  return mod;
}

function resolveFrom(root: string, value: string | undefined | null): string | null {
  if (value == null || value === "") return null;
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function resolveRate(raw: UserConfig): ResolvedRateConfig {
  const rate = raw.rate ?? {};
  if (rate.requestsPerMinute != null) {
    return {
      requestsPerMinute: Number(rate.requestsPerMinute),
      jitterSec: Number(rate.jitterSec ?? 2),
    };
  }
  if (rate.sleepMin != null) {
    const min = Number(rate.sleepMin);
    const max = Number(rate.sleepMax ?? rate.sleepMin);
    const avg = (min + max) / 2 || min || 12;
    const rpm = Math.max(1, Math.round(60 / avg));
    console.warn(
      `[config] rate.sleepMin/sleepMax 已废弃，已换算为 requestsPerMinute=${rpm}。请改成 rate.requestsPerMinute。`,
    );
    return { requestsPerMinute: rpm, jitterSec: Number(rate.jitterSec ?? 2) };
  }
  return { requestsPerMinute: 5, jitterSec: Number(rate.jitterSec ?? 2) };
}

function asSourceType(value: unknown): SourceType | undefined {
  if (value === "http" || value === "local_jsonl") return value;
  return undefined;
}

function isHttpOptions(value: Record<string, unknown>): value is HttpSourceOptions & Record<string, unknown> {
  return typeof value.url === "string" && value.url.length > 0;
}

function isLocalOptions(value: Record<string, unknown>): value is LocalJsonlSourceOptions & Record<string, unknown> {
  return typeof value.path === "string" && value.path.length > 0;
}

/**
 * 把配置里的 sources 规范化成带 type 的列表。
 * 兼容旧写法：`name: "people_search"` 且未声明 type。
 */
export function normalizeSources(raw: unknown): ResolvedSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ResolvedSource[] = [];
  const names = new Set<string>();

  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = String(item.name ?? "").trim();
    if (!name) throw new Error("sources[] 每条都必须有 name");
    if (names.has(name)) throw new Error(`sources 中 name 重复: ${name}`);
    names.add(name);

    const enabled = item.enabled !== false;
    const options = isRecord(item.options) ? item.options : {};
    let type = asSourceType(item.type);

    if (!type && name === "people_search") {
      type = "http";
      const merged = applyLegacyPeopleOptions(PEOPLE_SEARCH_HTTP, options);
      out.push({ name, type, enabled, options: merged });
      console.warn(
        `[config] 源 ${name} 未写 type，已按旧版 people_search 展开。请改为 type: "http" 并写全 options。`,
      );
      continue;
    }
    if (!type && name === "local_jsonl") {
      type = "local_jsonl";
    }
    if (!type) {
      throw new Error(
        `源 ${name} 缺少 type（http | local_jsonl）。多个接口请各写一条 sources[]，用 type: "http" 区分 URL。`,
      );
    }

    if (type === "http") {
      if (!isHttpOptions(options)) {
        throw new Error(`HTTP 源 ${name} 的 options.url 必填`);
      }
      out.push({ name, type, enabled, options });
      continue;
    }

    if (!isLocalOptions(options)) {
      throw new Error(`local_jsonl 源 ${name} 的 options.path 必填`);
    }
    out.push({ name, type, enabled, options });
  }
  return out;
}

export interface LoadUserConfigOptions {
  command: string;
  config?: string;
  cwd?: string;
}

/**
 * 解析并规范化用户配置。
 * 配置可为对象，或 `(ctx) => object` 的函数。
 */
export async function loadUserConfig(opts: LoadUserConfigOptions): Promise<ResolvedConfig> {
  const cwd = opts.cwd ?? process.cwd();
  const command = opts.command;
  const configFile = findConfigFile(cwd, opts.config);
  if (!configFile) {
    throw new Error(
      [
        `未找到 model-training.config.json（当前目录: ${cwd}）。`,
        "请任选其一：",
        "  1) 在仓库根启动 Web（会自动写出默认配置）或执行 mtrain init",
        "  2) 加 -c 指定配置文件",
        `扫描文件名: ${CONFIG_NAMES.join(", ")}`,
      ].join("\n"),
    );
  }

  let raw: unknown = await importConfig(configFile);
  if (typeof raw === "function") {
    raw = await (raw as UserConfigFn)({ command, mode: command, cwd });
  }
  if (!isRecord(raw)) {
    throw new Error(`配置必须 export default 一个对象: ${configFile}`);
  }
  const cfg = raw as UserConfig;

  const root = path.dirname(configFile);
  const outDir = resolveFrom(root, cfg.outDir || cfg.out_dir) || path.join(root, "outputs");
  if (isInsideDir(PKG_ROOT, outDir) && path.basename(PKG_ROOT) === "core") {
    /* 克隆即运行：允许仓库根 outputs；禁止写进 packages/core */
    throw new Error(`outDir 不能落在 ${PKG_ROOT} 内。请使用仓库根下的 outputs。`);
  }

  const cacheDir =
    resolveFrom(root, cfg.cacheDir || cfg.cache_dir) || path.join(os.homedir(), ".model-training", "cache");

  const dict = resolveFrom(root, cfg.dict || cfg.dict_path);
  const trainConfig = resolveFrom(root, cfg.train?.config);
  const trainOutputDir = resolveFrom(root, cfg.train?.outputDir);
  const importSource = resolveFrom(root, cfg.import?.source ?? cfg.importSource);
  const importLimit = cfg.import?.limit ?? cfg.importLimit ?? null;
  const lfDatasetDir = resolveFrom(root, cfg.llamafactory?.datasetDir ?? cfg.lfDatasetDir);
  const lfDatasetInfo = cfg.llamafactory?.datasetInfo ?? cfg.lfDatasetInfo ?? "dataset_info.json";
  const lfPrefix = cfg.llamafactory?.prefix ?? cfg.lfPrefix ?? "corr";
  const infer: InferConfig = cfg.infer ?? { backend: "rule" };
  const split: ResolvedConfig["split"] = {
    unseenPairRatio: cfg.split?.unseenPairRatio ?? 0.1,
    seenPairEvalRatio: cfg.split?.seenPairEvalRatio ?? 0.1,
    minPairSizeForSeenEval: cfg.split?.minPairSizeForSeenEval ?? 2,
    keepRatio: cfg.split?.keepRatio ?? 0.02,
    maxKeep: cfg.split?.maxKeep ?? 400,
    maxUnseenPairs: cfg.split?.maxUnseenPairs ?? null,
    maxTrain: cfg.split?.maxTrain ?? null,
    seed: cfg.split?.seed ?? 42,
  };

  return {
    command,
    cwd,
    root,
    configFile,
    outDir,
    cacheDir,
    dict,
    pairsPerTerm: cfg.pairsPerTerm ?? 3,
    limitTerms: cfg.limitTerms ?? null,
    cleanRatio: Number(cfg.cleanRatio ?? 0.1),
    maxPages: Number(cfg.maxPages ?? 3),
    instruction: cfg.instruction ?? DEFAULT_INSTRUCTION,
    formats: parseFormats(cfg.formats),
    sentence: {
      minLen: cfg.sentence?.minLen ?? 16,
      maxLen: cfg.sentence?.maxLen ?? 220,
    },
    rate: resolveRate(cfg),
    sources: normalizeSources(cfg.sources),
    infer,
    split,
    trainConfig,
    trainOutputDir,
    importSource,
    importLimit,
    lfDatasetDir,
    lfDatasetInfo,
    lfPrefix,
    paths: {
      dict,
      sft: path.join(outDir, "sft", "train.jsonl"),
      sftSharegpt: path.join(outDir, "sft", "train_sharegpt.jsonl"),
      trainSplit: path.join(outDir, "splits", "train.jsonl"),
      trainSplitSharegpt: path.join(outDir, "splits", "train_sharegpt.jsonl"),
      eval: path.join(outDir, "eval", "eval.jsonl"),
      evalSeen: path.join(outDir, "eval", "eval_seen_pair.jsonl"),
      evalUnseen: path.join(outDir, "eval", "eval_unseen_pair.jsonl"),
      evalKeep: path.join(outDir, "eval", "eval_keep.jsonl"),
      pred: path.join(outDir, "infer", "pred.jsonl"),
      predSeen: path.join(outDir, "infer", "pred_seen_pair.jsonl"),
      predUnseen: path.join(outDir, "infer", "pred_unseen_pair.jsonl"),
      predKeep: path.join(outDir, "infer", "pred_keep.jsonl"),
      metrics: path.join(outDir, "reports", "metrics.json"),
      scored: path.join(outDir, "reports", "scored.jsonl"),
      splitReport: path.join(outDir, "reports", "split.json"),
      analysis: path.join(outDir, "reports", "analysis.md"),
      compare: path.join(outDir, "reports", "compare.md"),
      runsDir: path.join(outDir, "reports", "runs"),
      bestDir: path.join(outDir, "reports", "best"),
      leaderboard: path.join(outDir, "reports", "leaderboard.json"),
    },
  };
}

export { PKG_ROOT };

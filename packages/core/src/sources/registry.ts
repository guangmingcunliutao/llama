/**
 * 按配置构造检索源。代码里只认识 type（http / local_jsonl），
 * 具体 URL 和字段映射全部来自配置，因此可以并列多个 HTTP 接口。
 */
import path from "node:path";
import { RequestRateLimiter } from "../rateLimit.js";
import type { ResolvedConfig, ResolvedSource, SearchSource } from "../types.js";
import { HttpSearchSource } from "./http.js";
import { LocalJsonlSource } from "./localJsonl.js";

export const SOURCE_TYPES = ["http", "local_jsonl"] as const;

export function availableSourceTypes(): string[] {
  return [...SOURCE_TYPES];
}

export interface BuildSourceContext {
  root: string;
  cacheDir: string;
  globalLimiter: RequestRateLimiter;
  signal?: AbortSignal;
}

export function buildSource(item: ResolvedSource, ctx: BuildSourceContext): SearchSource {
  if (item.type === "local_jsonl") {
    const filePath = path.isAbsolute(item.options.path)
      ? item.options.path
      : path.resolve(ctx.root, item.options.path);
    return new LocalJsonlSource(item.name, { ...item.options, path: filePath });
  }

  const rpm = item.options.requestsPerMinute;
  const limiter =
    rpm != null && rpm !== ctx.globalLimiter.requestsPerMinute
      ? new RequestRateLimiter(rpm, ctx.globalLimiter.jitterSec)
      : ctx.globalLimiter;

  const cacheDir = item.options.cacheDir
    ? item.options.cacheDir
    : path.join(ctx.cacheDir, item.name);

  return new HttpSearchSource(item.name, { ...item.options, cacheDir }, limiter, ctx.signal);
}

/** 选出已启用的源；`--source name` 只保留这一条。 */
export function selectSources(cfg: ResolvedConfig, onlyName?: string): ResolvedSource[] {
  const enabled = cfg.sources.filter((item) => item.enabled);
  if (onlyName) {
    const matched = enabled.filter((item) => item.name === onlyName);
    if (!matched.length) {
      const names = enabled.map((item) => item.name).join(", ") || "(无)";
      throw new Error(`找不到源 ${onlyName}。当前启用: ${names}`);
    }
    return matched;
  }
  return enabled;
}

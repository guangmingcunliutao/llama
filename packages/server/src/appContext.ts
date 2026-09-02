/**
 * 服务端对仓库根与配置文件的访问。路由和任务命令都依赖这份抽象，而不是直接读环境变量。
 */
import fs from "node:fs";
import path from "node:path";
import { defaultUserConfig, findRepoRoot, sourceDisplay } from "@model-training/core";
import { isJsonObject } from "./api/envelope.js";

export interface AppContext {
  dataRoot(): string;
  configPath(): string;
  readConfigFile(): Record<string, unknown>;
  writeConfigFile(body: Record<string, unknown>): void;
}

export function createAppContext(): AppContext {
  function dataRoot(): string {
    return process.env.MODEL_TRAINING_DATA || findRepoRoot(process.cwd());
  }

  function configPath(): string {
    return path.join(dataRoot(), "model-training.config.json");
  }

  function readConfigFile(): Record<string, unknown> {
    const file = configPath();
    if (!fs.existsSync(file)) {
      const created = defaultUserConfig() as unknown as Record<string, unknown>;
      writeConfigFile(created);
      return created;
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isJsonObject(parsed)) {
      throw new Error("配置文件必须是 JSON 对象");
    }
    return parsed;
  }

  function writeConfigFile(body: Record<string, unknown>): void {
    fs.writeFileSync(configPath(), `${JSON.stringify(body, null, 2)}\n`, "utf8");
  }

  return { dataRoot, configPath, readConfigFile, writeConfigFile };
}

/** GET /api/config 时补上界面标题，不改磁盘上的主键 `name`。 */
export function presentConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const sources = raw.sources;
  if (!Array.isArray(sources)) return raw;
  return {
    ...raw,
    sources: sources.map((item) => {
      if (!isJsonObject(item)) return item;
      const name = String(item.name ?? "");
      const display = sourceDisplay({
        name,
        title: typeof item.title === "string" ? item.title : undefined,
        description: typeof item.description === "string" ? item.description : undefined,
      });
      return { ...item, title: display.title, description: display.description };
    }),
  };
}

export function persistGeneratePatch(ctx: AppContext, body: Record<string, unknown>): void {
  const raw = ctx.readConfigFile();
  const next: Record<string, unknown> = { ...raw };
  if (body.pairsPerTerm != null) next.pairsPerTerm = Number(body.pairsPerTerm);
  if (body.limitTerms != null || body.maxWords != null) {
    const n = Number(body.limitTerms ?? body.maxWords);
    next.limitTerms = n > 0 ? n : null;
  }
  if (body.cleanRatio != null) {
    const n = Number(body.cleanRatio);
    next.cleanRatio = n > 1 ? n / 100 : n;
  }
  if (body.maxPages != null) next.maxPages = Number(body.maxPages);
  if (typeof body.instruction === "string" && body.instruction.trim()) next.instruction = body.instruction;
  if (typeof body.format === "string" && body.format.trim()) {
    next.formats = body.format.split(/[,+\s]+/).filter(Boolean);
  }
  if (isJsonObject(body.sentence)) {
    next.sentence = { ...(isJsonObject(raw.sentence) ? raw.sentence : {}), ...body.sentence };
  }
  if (isJsonObject(body.rate)) {
    next.rate = { ...(isJsonObject(raw.rate) ? raw.rate : {}), ...body.rate };
  }
  ctx.writeConfigFile(next);
}

export function persistLlamaFactory(ctx: AppContext, body: Record<string, unknown>): void {
  const home = typeof body.home === "string" ? body.home.trim() : undefined;
  const bin = typeof body.bin === "string" ? body.bin.trim() : undefined;
  const hub = typeof body.hub === "string" ? body.hub.trim() : undefined;
  const hfEndpoint = typeof body.hfEndpoint === "string" ? body.hfEndpoint.trim() : undefined;
  if (home === undefined && bin === undefined && hub === undefined && hfEndpoint === undefined) return;
  const raw = ctx.readConfigFile();
  const prev = isJsonObject(raw.llamafactory) ? raw.llamafactory : {};
  const llamafactory: Record<string, unknown> = { ...prev };
  if (home !== undefined) llamafactory.home = home;
  if (bin !== undefined) llamafactory.bin = bin;
  if (hub !== undefined) llamafactory.hub = hub;
  if (hfEndpoint !== undefined) llamafactory.hfEndpoint = hfEndpoint;
  ctx.writeConfigFile({ ...raw, llamafactory });
}

export function trainPatch(body: Record<string, unknown>): Record<string, string | number | boolean> | undefined {
  if (!isJsonObject(body.knobs)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(body.knobs)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

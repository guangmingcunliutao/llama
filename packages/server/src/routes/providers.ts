/**
 * GET /api/providers
 * 对齐 Python `available_providers()`：列出检索源 id / 展示名 / 说明。
 */
import type { FastifyPluginAsync } from "fastify";
import { isJsonObject, ok } from "../api/envelope.js";
import { presentConfig } from "../appContext.js";

export function listProviders(raw: Record<string, unknown>): Array<{
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}> {
  const presented = presentConfig(raw);
  const sources = Array.isArray(presented.sources) ? presented.sources : [];
  return sources.filter(isJsonObject).map((item) => ({
    id: String(item.name ?? ""),
    name: String(item.title ?? item.name ?? ""),
    description: String(item.description ?? ""),
    enabled: item.enabled !== false,
  }));
}

const providersRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/providers", async () => {
    const raw = app.ctx.readConfigFile();
    return ok({
      providers: listProviders(raw),
      instruction: typeof raw.instruction === "string" ? raw.instruction : "",
    });
  });
};

export default providersRoute;

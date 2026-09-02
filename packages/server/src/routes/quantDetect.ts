/** GET /api/quant/detect  GET /api/quant/env */
import type { FastifyPluginAsync } from "fastify";
import { detectQuantTools, loadUserConfig } from "@model-training/core";
import { fail, ok } from "../api/envelope.js";
import { detectQuantSource } from "../datasets.js";

const quantDetectRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/quant/env", async () => {
    const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
    return ok({
      ...detectQuantTools({
        llamaHome: cfg.quantHome,
        llamaQuantize: cfg.quantBin,
        convertScript: cfg.quantConvertScript,
        lfHome: cfg.lfHome,
      }),
      llamaHome: cfg.quantHome,
      convertScript: cfg.quantConvertScript,
    });
  });

  app.get("/api/quant/detect", async (request, reply) => {
    const q = request.query as { path?: string };
    const target = String(q.path ?? "").trim();
    if (!target) return reply.code(400).send(fail("缺少 path"));
    return ok(detectQuantSource(target));
  });
};

export default quantDetectRoute;

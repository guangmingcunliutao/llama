/**
 * GET /api/train/env — 检测本机 LlamaFactory / Python，供训练页展示。
 */
import { detectLlamaFactory, loadUserConfig } from "@model-training/core";
import type { FastifyPluginAsync } from "fastify";
import { asFlag, ok } from "../api/envelope.js";

const trainEnvRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/train/env", async (request) => {
    const query = request.query as Record<string, unknown>;
    const cfg = await loadUserConfig({ command: "train", cwd: app.ctx.dataRoot() });
    const detect = detectLlamaFactory({
      home: asFlag(query.home) ?? cfg.lfHome,
      bin: asFlag(query.bin) ?? cfg.lfBin,
    });
    return ok(detect);
  });
};

export default trainEnvRoute;

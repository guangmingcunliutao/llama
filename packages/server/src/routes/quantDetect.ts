/** GET /api/quant/detect */
import type { FastifyPluginAsync } from "fastify";
import { fail, ok } from "../api/envelope.js";
import { detectQuantSource } from "../datasets.js";

const quantDetectRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/quant/detect", async (request, reply) => {
    const q = request.query as { path?: string };
    const target = String(q.path ?? "").trim();
    if (!target) return reply.code(400).send(fail("缺少 path"));
    return ok(detectQuantSource(target));
  });
};

export default quantDetectRoute;

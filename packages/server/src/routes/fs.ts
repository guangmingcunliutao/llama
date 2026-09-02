/**
 * GET /api/fs/roots、GET /api/fs/list — 训练页选择本机模型目录。
 */
import { listFsDir, listFsRoots } from "@model-training/core";
import type { FastifyPluginAsync } from "fastify";
import { asFlag, fail, ok } from "../api/envelope.js";

const fsRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/fs/roots", async () => ok({ roots: listFsRoots() }));

  app.get("/api/fs/list", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const dir = asFlag(query.path);
    if (!dir) {
      return reply.code(400).send(fail("缺少 path"));
    }
    try {
      return ok(listFsDir(dir));
    } catch (err) {
      return reply.code(400).send(fail(err instanceof Error ? err.message : String(err)));
    }
  });
};

export default fsRoute;

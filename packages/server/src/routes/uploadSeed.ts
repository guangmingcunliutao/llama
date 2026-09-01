/** POST /api/upload/seed */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsync } from "fastify";
import { loadUserConfig } from "@model-training/core";
import { fail } from "../api/envelope.js";
import { datasetStatus, saveSeedAndPrepare } from "../datasets.js";

const uploadSeedRoute: FastifyPluginAsync = async (app) => {
  app.post("/api/upload/seed", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send(fail("请选择种子文件"));
    app.ctx.readConfigFile();
    const cfg = await loadUserConfig({ command: "prepare", cwd: app.ctx.dataRoot() });
    if (!cfg.dict) return reply.code(400).send(fail("配置里没有 dict 路径"));
    const uploads = path.join(app.ctx.dataRoot(), "uploads");
    fs.mkdirSync(uploads, { recursive: true });
    const safeName = path.basename(file.filename).replace(/[^\w.\u4e00-\u9fa5-]/g, "_");
    const tmpFile = path.join(uploads, safeName || "seed.xlsx");
    await pipeline(file.file, fs.createWriteStream(tmpFile));
    const result = saveSeedAndPrepare({
      cwd: app.ctx.dataRoot(),
      dictPath: cfg.dict,
      tmpFile,
      originalName: file.filename,
    });
    return { ok: true, ...result, data: await datasetStatus(app.ctx.dataRoot()) };
  });
};

export default uploadSeedRoute;

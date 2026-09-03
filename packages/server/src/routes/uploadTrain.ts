/** POST /api/upload/train — 上传现成训练 jsonl，新建数据实验并划分验证集。 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsync } from "fastify";
import { importReadyTrain, loadUserConfig } from "@model-training/core";
import { fail } from "../api/envelope.js";
import { datasetStatus } from "../datasets.js";

const TRAIN_EXTS = new Set([".jsonl", ".json"]);

const uploadTrainRoute: FastifyPluginAsync = async (app) => {
  app.post("/api/upload/train", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send(fail("请选择训练数据文件"));
    const ext = path.extname(file.filename).toLowerCase();
    if (!TRAIN_EXTS.has(ext)) {
      return reply.code(400).send(fail("训练数据请上传 .jsonl 或 .json（messages / alpaca / sharegpt）"));
    }
    app.ctx.readConfigFile();
    const cfg = await loadUserConfig({ command: "import", cwd: app.ctx.dataRoot() });
    const uploads = path.join(app.ctx.dataRoot(), "uploads");
    fs.mkdirSync(uploads, { recursive: true });
    const safeName = path.basename(file.filename).replace(/[^\w.\u4e00-\u9fa5-]/g, "_");
    const tmpFile = path.join(uploads, safeName || "train.jsonl");
    await pipeline(file.file, fs.createWriteStream(tmpFile));
    const imported = importReadyTrain(cfg, {
      input: tmpFile,
      label: path.parse(file.filename).name,
    });
    return {
      ok: true,
      data: {
        ...(await datasetStatus(app.ctx.dataRoot())),
        imported,
      },
    };
  });
};

export default uploadTrainRoute;

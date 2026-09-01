/**
 * Web 入口：静态页 + /api。
 * 长任务走 JobCommand 注册表；查询类接口返回 `{ ok, data }`，扩展字段加在 data 上。
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { loadUserConfig, parseTrainYaml } from "@model-training/core";
import { fail, isJsonObject, ok } from "./api/envelope.js";
import { createAppContext, presentConfig } from "./appContext.js";
import { datasetStatus, detectQuantSource, saveSeedAndPrepare } from "./datasets.js";
import { JOB_COMMANDS } from "./jobs/commands.js";
import { createJobDispatcher } from "./jobs/dispatcher.js";
import { createJobHub } from "./jobs/hub.js";

function listenHost(): string {
  return process.env.MODEL_TRAINING_HOST || "127.0.0.1";
}

function listenPort(): number {
  const raw = process.env.MODEL_TRAINING_PORT;
  const n = raw ? Number(raw) : 5000;
  return Number.isFinite(n) ? n : 5000;
}

function findWebDist(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../web/dist"),
    path.resolve(process.cwd(), "packages/web/dist"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

function readJsonIfExists(file: string): unknown {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function readTextIfExists(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

async function main(): Promise<void> {
  const app = Fastify({ logger: true });
  const ctx = createAppContext();
  const jobs = createJobHub();
  const dispatcher = createJobDispatcher(ctx, jobs, JOB_COMMANDS);

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 80 * 1024 * 1024 } });

  app.get("/api/health", async () => ok({ status: "up" }));

  app.get("/api/config", async () => ok(presentConfig(ctx.readConfigFile())));

  app.put("/api/config", async (request, reply) => {
    const body = request.body;
    if (!isJsonObject(body)) {
      return reply.code(400).send(fail("配置必须是 JSON 对象"));
    }
    ctx.writeConfigFile(body);
    return ok(body);
  });

  app.get("/api/jobs", async () => jobs.snapshot());

  app.get("/api/datasets", async () => {
    ctx.readConfigFile();
    return ok(await datasetStatus(ctx.dataRoot()));
  });

  app.post("/api/upload/seed", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send(fail("请选择种子文件"));
    ctx.readConfigFile();
    const cfg = await loadUserConfig({ command: "prepare", cwd: ctx.dataRoot() });
    if (!cfg.dict) return reply.code(400).send(fail("配置里没有 dict 路径"));
    const uploads = path.join(ctx.dataRoot(), "uploads");
    fs.mkdirSync(uploads, { recursive: true });
    const safeName = path.basename(file.filename).replace(/[^\w.\u4e00-\u9fa5-]/g, "_");
    const tmpFile = path.join(uploads, safeName || "seed.xlsx");
    await pipeline(file.file, fs.createWriteStream(tmpFile));
    const result = saveSeedAndPrepare({
      cwd: ctx.dataRoot(),
      dictPath: cfg.dict,
      tmpFile,
      originalName: file.filename,
    });
    return { ok: true, ...result, data: await datasetStatus(ctx.dataRoot()) };
  });

  app.post("/api/jobs/cancel", async () => {
    jobs.cancel();
    return jobs.snapshot();
  });

  for (const command of JOB_COMMANDS) {
    app.post(`/api/jobs/${command.name}`, async (request, reply) => {
      ctx.readConfigFile();
      const result = await dispatcher.dispatch(command.name, request.body);
      return reply.code(result.status).send(result.body);
    });
  }

  app.get("/api/reports", async () => {
    ctx.readConfigFile();
    const cfg = await loadUserConfig({ command: "status", cwd: ctx.dataRoot() });
    const bundled = path.join(cfg.outDir, "llamafactory", "train_sft.yaml");
    const yamlText =
      cfg.trainConfig && fs.existsSync(cfg.trainConfig)
        ? fs.readFileSync(cfg.trainConfig, "utf8")
        : fs.existsSync(bundled)
          ? fs.readFileSync(bundled, "utf8")
          : "";
    return ok({
      metrics: readJsonIfExists(cfg.paths.metrics),
      analysis: readTextIfExists(cfg.paths.analysis),
      compare: readTextIfExists(cfg.paths.compare),
      trainYaml: cfg.trainConfig,
      trainKnobs: parseTrainYaml(yamlText),
    });
  });

  app.get("/api/quant/detect", async (request, reply) => {
    const q = request.query as { path?: string };
    const target = String(q.path ?? "").trim();
    if (!target) return reply.code(400).send(fail("缺少 path"));
    return ok(detectQuantSource(target));
  });

  const webDist = findWebDist();
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) {
        return reply.code(404).send(fail("not found"));
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.log.warn("未找到 @model-training/web 的 dist，仅提供 /api。请先 pnpm --filter @model-training/web build");
  }

  const host = listenHost();
  const port = listenPort();
  await app.listen({ host, port });
  app.log.info(`model-training webui http://${host}:${port}`);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

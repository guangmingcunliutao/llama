/**
 * Web 入口：静态页 + 按文件拆开的 /api 插件。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { fail } from "./api/envelope.js";
import { createAppContext } from "./appContext.js";
import { JOB_COMMANDS } from "./jobs/commands.js";
import { createJobDispatcher } from "./jobs/dispatcher.js";
import { createJobHub } from "./jobs/hub.js";
import { decorateApp } from "./plugins/decorate.js";
import { registerRoutes } from "./routes/index.js";
import { shouldServeSpaIndex } from "./webStatic.js";

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

async function main(): Promise<void> {
  const app = Fastify({ logger: true });
  const ctx = createAppContext();
  const jobs = createJobHub();
  const dispatcher = createJobDispatcher(ctx, jobs, JOB_COMMANDS);
  decorateApp(app, { ctx, jobs, dispatcher });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 80 * 1024 * 1024 } });
  await registerRoutes(app);

  const webDist = findWebDist();
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (!shouldServeSpaIndex(request.url)) {
        return reply.code(404).send(fail("not found"));
      }
      reply.header("Cache-Control", "no-store");
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

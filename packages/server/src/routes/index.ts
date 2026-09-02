/**
 * 注册全部 HTTP 路由。新增接口：在本目录加一个 Fastify 插件文件，并在这里 register。
 * 检索源列表走 /api/providers（对齐 Python SentenceProvider 注册表）。
 */
import type { FastifyInstance } from "fastify";
import configRoute from "./config.js";
import datasetsRoute from "./datasets.js";
import fsRoute from "./fs.js";
import healthRoute from "./health.js";
import jobsRoute from "./jobs.js";
import providersRoute from "./providers.js";
import quantDetectRoute from "./quantDetect.js";
import reportsRoute from "./reports.js";
import trainEnvRoute from "./trainEnv.js";
import uploadSeedRoute from "./uploadSeed.js";

const PLUGINS = [
  healthRoute,
  configRoute,
  providersRoute,
  datasetsRoute,
  fsRoute,
  uploadSeedRoute,
  jobsRoute,
  reportsRoute,
  quantDetectRoute,
  trainEnvRoute,
];

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  for (const plugin of PLUGINS) {
    await app.register(plugin);
  }
}

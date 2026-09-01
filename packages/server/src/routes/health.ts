/** GET /api/health */
import type { FastifyPluginAsync } from "fastify";
import { ok } from "../api/envelope.js";

const healthRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/health", async () => ok({ status: "up" }));
};

export default healthRoute;

/** GET /api/datasets */
import type { FastifyPluginAsync } from "fastify";
import { ok } from "../api/envelope.js";
import { datasetStatus } from "../datasets.js";

const datasetsRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/datasets", async () => {
    app.ctx.readConfigFile();
    return ok(await datasetStatus(app.ctx.dataRoot()));
  });
};

export default datasetsRoute;

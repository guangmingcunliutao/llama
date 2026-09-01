/** GET/PUT /api/config */
import type { FastifyPluginAsync } from "fastify";
import { fail, isJsonObject, ok } from "../api/envelope.js";
import { presentConfig } from "../appContext.js";

const configRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/config", async () => ok(presentConfig(app.ctx.readConfigFile())));

  app.put("/api/config", async (request, reply) => {
    const body = request.body;
    if (!isJsonObject(body)) {
      return reply.code(400).send(fail("配置必须是 JSON 对象"));
    }
    app.ctx.writeConfigFile(body);
    return ok(body);
  });
};

export default configRoute;

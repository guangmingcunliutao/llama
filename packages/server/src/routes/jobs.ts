/** GET /api/jobs、POST /api/jobs/cancel、POST /api/jobs/:name */
import type { FastifyPluginAsync } from "fastify";
import { JOB_COMMANDS } from "../jobs/commands.js";

const jobsRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/jobs", async () => app.jobs.snapshot());

  app.post("/api/jobs/cancel", async () => {
    app.jobs.cancel();
    return app.jobs.snapshot();
  });

  for (const command of JOB_COMMANDS) {
    app.post(`/api/jobs/${command.name}`, async (request, reply) => {
      app.ctx.readConfigFile();
      const result = await app.dispatcher.dispatch(command.name, request.body);
      return reply.code(result.status).send(result.body);
    });
  }
};

export default jobsRoute;

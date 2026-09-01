/**
 * Fastify 装饰：路由文件通过 app.ctx / app.jobs / app.dispatcher 取依赖。
 */
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../appContext.js";
import type { createJobDispatcher } from "../jobs/dispatcher.js";
import type { JobHub } from "../jobs/types.js";

export type JobDispatcher = ReturnType<typeof createJobDispatcher>;

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
    jobs: JobHub;
    dispatcher: JobDispatcher;
  }
}

export function decorateApp(
  app: FastifyInstance,
  deps: { ctx: AppContext; jobs: JobHub; dispatcher: JobDispatcher },
): void {
  app.decorate("ctx", deps.ctx);
  app.decorate("jobs", deps.jobs);
  app.decorate("dispatcher", deps.dispatcher);
}

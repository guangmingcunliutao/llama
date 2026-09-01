/**
 * 长任务命令接口（Command）。
 * 新增 generate / train / 量化 等任务时只加一个实现并注册，不要在 Fastify 路由里再堆分支。
 */
import type { AppContext } from "../appContext.js";
import type { JobContext, JobSnapshot } from "./hub.js";

export type JobName = "generate" | "generate-eval" | "train" | "infer" | "evaluate" | "analyze";

export interface JobCommand {
  readonly name: JobName;
  /** 返回错误文案则 HTTP 400，不启动任务 */
  validate(app: AppContext, body: Record<string, unknown>): Promise<string | null>;
  execute(app: AppContext, job: JobContext, body: Record<string, unknown>): Promise<void>;
}

export interface JobDispatchResult {
  status: 200 | 400 | 404 | 409;
  body: JobSnapshot;
}

export interface JobHub {
  snapshot(): JobSnapshot;
  start(name: string, run: (ctx: JobContext) => Promise<void>): void;
  cancel(): void;
}

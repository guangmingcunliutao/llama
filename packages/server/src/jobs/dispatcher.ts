/**
 * 任务分发器：按 name 查找 Command，先 validate 再异步 execute。
 */
import { errMessage, isJsonObject } from "../api/envelope.js";
import type { AppContext } from "../appContext.js";
import type { JobCommand, JobDispatchResult, JobHub } from "./types.js";

export function createJobDispatcher(app: AppContext, hub: JobHub, commands: JobCommand[]) {
  const registry = new Map<string, JobCommand>(commands.map((command) => [command.name, command]));

  async function dispatch(name: string, body: unknown): Promise<JobDispatchResult> {
    const command = registry.get(name);
    if (!command) {
      return {
        status: 404,
        body: { ...hub.snapshot(), ok: false, error: `未知任务: ${name}` },
      };
    }
    const payload = isJsonObject(body) ? body : {};
    const invalid = await command.validate(app, payload);
    if (invalid) {
      return {
        status: 400,
        body: { ...hub.snapshot(), ok: false, busy: false, error: invalid },
      };
    }
    try {
      hub.start(command.name, (ctx) => command.execute(app, ctx, payload));
      return { status: 200, body: { ...hub.snapshot(), ok: true } };
    } catch (err) {
      return {
        status: 409,
        body: { ...hub.snapshot(), ok: false, error: errMessage(err) },
      };
    }
  }

  return { dispatch, names: () => [...registry.keys()] };
}

import type { FastifyPluginAsync } from "fastify";
import {
  dataRunPaths,
  deleteRun,
  evalRunPaths,
  listRuns,
  loadUserConfig,
  loadWorkspace,
  patchWorkspace,
  readDataProgress,
  readRun,
  selectRun,
  tailLog,
  trainRunPaths,
} from "@model-training/core";
import type { RunKind } from "@model-training/core";
import { fail, isJsonObject, ok } from "../api/envelope.js";

function asKind(value: unknown): RunKind | null {
  if (value === "data" || value === "train" || value === "eval") return value;
  return null;
}

const runsRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/workspace", async () => {
    const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
    return ok({
      ...loadWorkspace(cfg.outDir),
      outDir: cfg.outDir,
    });
  });

  app.put("/api/workspace", async (request, reply) => {
    const body = isJsonObject(request.body) ? request.body : {};
    const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
    const next = patchWorkspace(cfg.outDir, {
      dataRunId: body.dataRunId === null ? null : typeof body.dataRunId === "string" ? body.dataRunId : undefined,
      trainRunId: body.trainRunId === null ? null : typeof body.trainRunId === "string" ? body.trainRunId : undefined,
      evalRunId: body.evalRunId === null ? null : typeof body.evalRunId === "string" ? body.evalRunId : undefined,
    });
    return reply.send(ok(next));
  });

  app.get("/api/runs", async (request, reply) => {
    const query = request.query as { kind?: string };
    const kind = asKind(query.kind);
    const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
    if (!kind) {
      return reply.send(
        ok({
          workspace: loadWorkspace(cfg.outDir),
          data: listRuns(cfg.outDir, "data"),
          train: listRuns(cfg.outDir, "train"),
          eval: listRuns(cfg.outDir, "eval"),
        }),
      );
    }
    return reply.send(ok({ workspace: loadWorkspace(cfg.outDir), runs: listRuns(cfg.outDir, kind) }));
  });

  app.get("/api/runs/:kind/:id", async (request, reply) => {
    const { kind: rawKind, id } = request.params as { kind: string; id: string };
    const kind = asKind(rawKind);
    if (!kind) return reply.code(400).send(fail("kind 必须是 data / train / eval"));
    const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
    const meta = readRun(cfg.outDir, kind, id);
    if (!meta) return reply.code(404).send(fail(`找不到实验 ${kind}/${id}`));
    const logsFile =
      kind === "data"
        ? dataRunPaths(cfg.outDir, id).logs
        : kind === "train"
          ? trainRunPaths(cfg.outDir, id).logs
          : evalRunPaths(cfg.outDir, id).logs;
    return reply.send(
      ok({
        run: meta,
        progress: kind === "data" ? readDataProgress(cfg.outDir, id) : null,
        logs: tailLog(logsFile),
      }),
    );
  });

  app.post("/api/runs/:kind/:id/select", async (request, reply) => {
    const { kind: rawKind, id } = request.params as { kind: string; id: string };
    const kind = asKind(rawKind);
    if (!kind) return reply.code(400).send(fail("kind 必须是 data / train / eval"));
    const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
    try {
      return reply.send(ok(selectRun(cfg.outDir, kind, id)));
    } catch (err) {
      return reply.code(404).send(fail(err instanceof Error ? err.message : String(err)));
    }
  });

  app.delete("/api/runs/:kind/:id", async (request, reply) => {
    const { kind: rawKind, id } = request.params as { kind: string; id: string };
    const kind = asKind(rawKind);
    if (!kind) return reply.code(400).send(fail("kind 必须是 data / train / eval"));
    const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
    try {
      return reply.send(ok(deleteRun(cfg.outDir, kind, id)));
    } catch (err) {
      return reply.code(404).send(fail(err instanceof Error ? err.message : String(err)));
    }
  });
};

export default runsRoute;

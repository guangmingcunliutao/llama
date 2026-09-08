/** GET /api/lf 交接；POST 导出 / 准备训练 / 拉起 WebUI / 评估交接 */
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import {
  ensureLlamaFactoryWebui,
  ensureSwanLabWatch,
  evaluate,
  exportLfBoard,
  importLfPredictions,
  lfHandoffView,
  loadUserConfig,
  loadWorkspace,
  pathForLlamaFactory,
  patchRun,
  prepareLfEval,
  prepareLfRun,
  storeTrainRunId,
} from "@model-training/core";
import { asFlag, fail, isJsonObject, ok } from "../api/envelope.js";

const lfRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/lf", async () => {
    const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
    return ok(lfHandoffView(cfg));
  });

  app.post("/api/lf/export", async (_request, reply) => {
    try {
      const cfg = await loadUserConfig({ command: "export-lf", cwd: app.ctx.dataRoot() });
      const result = exportLfBoard(cfg);
      return ok({ ...result, datasetDirForLf: pathForLlamaFactory(result.datasetDir) });
    } catch (err) {
      return reply.code(400).send(fail(err instanceof Error ? err.message : String(err)));
    }
  });

  app.post("/api/lf/prepare", async (request, reply) => {
    const body = isJsonObject(request.body) ? request.body : {};
    try {
      const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
      const prepared = prepareLfRun(cfg, {
        label: asFlag(body.label),
        note: asFlag(body.note),
      });
      return ok({
        id: prepared.id,
        outputDir: prepared.outputDir,
        outputDirForLf: pathForLlamaFactory(prepared.outputDir),
        meta: prepared.meta,
        ...lfHandoffView(cfg),
      });
    } catch (err) {
      return reply.code(400).send(fail(err instanceof Error ? err.message : String(err)));
    }
  });

  app.post("/api/lf/webui/ensure", async (_request, reply) => {
    try {
      const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
      const result = await ensureLlamaFactoryWebui({
        home: cfg.lfHome,
        bin: cfg.lfBin,
        outDir: cfg.outDir,
      });
      return ok(result);
    } catch (err) {
      return reply.code(400).send(fail(err instanceof Error ? err.message : String(err)));
    }
  });

  app.post("/api/lf/swanlab/ensure", async (_request, reply) => {
    try {
      const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
      const result = await ensureSwanLabWatch({
        home: cfg.lfHome,
        bin: cfg.lfBin,
        outDir: cfg.outDir,
      });
      return ok({ ...result, logDirForLf: pathForLlamaFactory(path.join(cfg.outDir, "swanlog")) });
    } catch (err) {
      return reply.code(400).send(fail(err instanceof Error ? err.message : String(err)));
    }
  });

  app.post("/api/lf/prepare-eval", async (request, reply) => {
    const body = isJsonObject(request.body) ? request.body : {};
    try {
      const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
      const trainRunId = asFlag(body.trainRunId);
      if (!trainRunId) return reply.code(400).send(fail("请选择一次训练实验"));
      const prepared = prepareLfEval(cfg, { trainRunId, label: asFlag(body.label) });
      return ok({ ...prepared, ...lfHandoffView(cfg) });
    } catch (err) {
      return reply.code(400).send(fail(err instanceof Error ? err.message : String(err)));
    }
  });

  app.post("/api/lf/score", async (request, reply) => {
    const body = isJsonObject(request.body) ? request.body : {};
    try {
      const latest0 = await loadUserConfig({ command: "evaluate", cwd: app.ctx.dataRoot() });
      const evalRunId = asFlag(body.evalRunId) || loadWorkspace(latest0.outDir).evalRunId;
      const cfg = await loadUserConfig({
        command: "evaluate",
        cwd: app.ctx.dataRoot(),
        evalRunId,
        dataRunId: asFlag(body.dataRunId),
        trainRunId: storeTrainRunId(latest0.outDir, asFlag(body.trainRunId)),
      });
      const imported = importLfPredictions(cfg);
      const metrics = evaluate(cfg);
      if (evalRunId) {
        patchRun(latest0.outDir, "eval", evalRunId, { status: "completed", pid: null, error: null });
      }
      return ok({ imported, metrics });
    } catch (err) {
      return reply.code(400).send(fail(err instanceof Error ? err.message : String(err)));
    }
  });
};

export default lfRoute;

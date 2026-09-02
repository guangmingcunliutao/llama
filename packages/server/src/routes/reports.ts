/** GET /api/reports */
import fs from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { loadUserConfig, parseTrainYaml } from "@model-training/core";
import { ok } from "../api/envelope.js";

function readJsonIfExists(file: string): unknown {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function readTextIfExists(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

const reportsRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/reports", async () => {
    app.ctx.readConfigFile();
    const cfg = await loadUserConfig({ command: "status", cwd: app.ctx.dataRoot() });
    const bundled = path.join(cfg.outDir, "llamafactory", "train_sft.yaml");
    const yamlText =
      cfg.trainConfig && fs.existsSync(cfg.trainConfig)
        ? fs.readFileSync(cfg.trainConfig, "utf8")
        : fs.existsSync(bundled)
          ? fs.readFileSync(bundled, "utf8")
          : "";
    return ok({
      metrics: readJsonIfExists(cfg.paths.metrics),
      analysis: readTextIfExists(cfg.paths.analysis),
      compare: readTextIfExists(cfg.paths.compare),
      trainYaml: cfg.trainConfig,
      lfPredict: cfg.paths.lfPredict,
      trainKnobs: parseTrainYaml(yamlText),
    });
  });
};

export default reportsRoute;

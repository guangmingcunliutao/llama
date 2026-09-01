/**
 * 内置长任务。扩展时新增一个 JobCommand 并加入 JOB_COMMANDS。
 */
import fs from "node:fs";
import {
  analyze,
  evaluate,
  generate,
  generateEval,
  infer,
  loadUserConfig,
  startTrainFromConfig,
} from "@model-training/core";
import { asFlag, asStringList } from "../api/envelope.js";
import { persistGeneratePatch, trainPatch, type AppContext } from "../appContext.js";
import type { JobCommand } from "./types.js";

const generateCommand: JobCommand = {
  name: "generate",
  async validate(app: AppContext) {
    const cfg = await loadUserConfig({ command: "generate", cwd: app.dataRoot() });
    if (!cfg.dict || !fs.existsSync(cfg.dict)) {
      return "还没有词对字典，请先上传种子文件";
    }
    return null;
  },
  async execute(app, _job, body) {
    persistGeneratePatch(app, body);
    const latest = await loadUserConfig({ command: "generate", cwd: app.dataRoot() });
    await generate(latest, {
      pairsPerTerm: asFlag(body.pairsPerTerm),
      limitTerms: asFlag(body.limitTerms ?? body.maxWords),
      format: asFlag(body.format),
      instruction: asFlag(body.instruction),
      cleanRatio: asFlag(body.cleanRatio),
      maxPages: asFlag(body.maxPages),
      sources: asStringList(body.sources),
      output: asFlag(body.output),
    });
  },
};

const generateEvalCommand: JobCommand = {
  name: "generate-eval",
  async validate(app) {
    const cfg = await loadUserConfig({ command: "generate-eval", cwd: app.dataRoot() });
    if (!fs.existsSync(cfg.paths.sft)) {
      return `没有训练集 ${cfg.paths.sft}，请先生成训练数据`;
    }
    return null;
  },
  async execute(app) {
    const latest = await loadUserConfig({ command: "generate-eval", cwd: app.dataRoot() });
    await generateEval(latest);
  },
};

const trainCommand: JobCommand = {
  name: "train",
  async validate(app) {
    const cfg = await loadUserConfig({ command: "train", cwd: app.dataRoot() });
    if (!fs.existsSync(cfg.paths.sft)) {
      return `没有训练集 ${cfg.paths.sft}，请先在「数据生成」页生成`;
    }
    return null;
  },
  async execute(app, job, body) {
    const latest = await loadUserConfig({ command: "train", cwd: app.dataRoot() });
    const result = await startTrainFromConfig(latest, {
      signal: job.signal,
      onLog: job.onLog,
      patch: trainPatch(body),
    });
    if (result.cancelled) return;
    if (result.code !== 0) throw new Error(`llamafactory-cli 退出码 ${result.code}`);
  },
};

const inferCommand: JobCommand = {
  name: "infer",
  async validate() {
    return null;
  },
  async execute(app, _job, body) {
    const latest = await loadUserConfig({ command: "infer", cwd: app.dataRoot() });
    await infer(latest, {
      backend: asFlag(body.backend),
      url: asFlag(body.url),
      model: asFlag(body.model),
      all: body.all === true,
    });
  },
};

const evaluateCommand: JobCommand = {
  name: "evaluate",
  async validate() {
    return null;
  },
  async execute(app) {
    const latest = await loadUserConfig({ command: "evaluate", cwd: app.dataRoot() });
    evaluate(latest, { all: true });
  },
};

const analyzeCommand: JobCommand = {
  name: "analyze",
  async validate() {
    return null;
  },
  async execute(app, _job, body) {
    const latest = await loadUserConfig({ command: "analyze", cwd: app.dataRoot() });
    analyze(latest, {
      dir: asFlag(body.dir),
      trainConfig: asFlag(body.trainConfig),
      name: asFlag(body.name),
      note: asFlag(body.note),
      save: body.save === true,
      compare: body.compare === true,
      force: body.force === true,
    });
  },
};

export const JOB_COMMANDS: JobCommand[] = [
  generateCommand,
  generateEvalCommand,
  trainCommand,
  inferCommand,
  evaluateCommand,
  analyzeCommand,
];

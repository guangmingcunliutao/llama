/**
 * 内置长任务。扩展时新增一个 JobCommand 并加入 JOB_COMMANDS。
 */
import fs from "node:fs";
import path from "node:path";
import {
  analyze,
  detectLlamaFactory,
  evaluate,
  findBash,
  findGit,
  findSystemPython,
  generate,
  generateEval,
  infer,
  installLlamaFactory,
  loadUserConfig,
  locateInstallScript,
  looksLikeLlamaFactoryHome,
  startTrainFromConfig,
  validateModelSource,
} from "@model-training/core";
import { asFlag, asStringList, isJsonObject } from "../api/envelope.js";
import { persistGeneratePatch, persistLlamaFactory, trainPatch, type AppContext } from "../appContext.js";
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
  async execute(app, job, body) {
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
      signal: job.signal,
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
  async execute(app, job, body) {
    persistGeneratePatch(app, body);
    const latest = await loadUserConfig({ command: "generate-eval", cwd: app.dataRoot() });
    await generateEval(latest, {
      pairsPerTerm: asFlag(body.pairsPerTerm),
      limitTerms: asFlag(body.limitTerms ?? body.maxWords),
      cleanRatio: asFlag(body.cleanRatio),
      maxPages: asFlag(body.maxPages),
      sources: asStringList(body.sources),
      signal: job.signal,
    });
  },
};

const trainCommand: JobCommand = {
  name: "train",
  async validate(app, body) {
    const cfg = await loadUserConfig({ command: "train", cwd: app.dataRoot() });
    if (!fs.existsSync(cfg.paths.sft)) {
      return `没有训练句子 ${cfg.paths.sft}，请先在「数据」页生成`;
    }
    const detect = detectLlamaFactory({
      home: asFlag(body.home) ?? cfg.lfHome,
      bin: asFlag(body.bin) ?? cfg.lfBin,
    });
    if (!detect.ok) {
      return detect.errors.join("\n");
    }
    persistLlamaFactory(app, body);
    const knobs = isJsonObject(body.knobs) ? body.knobs : {};
    const model = typeof knobs.model_name_or_path === "string" ? knobs.model_name_or_path : "";
    if (model) {
      const invalid = validateModelSource({
        root: cfg.root,
        model,
        hub: asFlag(body.hub),
      });
      if (invalid) return invalid;
    }
    return null;
  },
  async execute(app, job, body) {
    persistLlamaFactory(app, body);
    const latest = await loadUserConfig({ command: "train", cwd: app.dataRoot() });
    const result = await startTrainFromConfig(latest, {
      signal: job.signal,
      onLog: job.onLog,
      patch: trainPatch(body),
      home: asFlag(body.home) ?? latest.lfHome,
      bin: asFlag(body.bin) ?? latest.lfBin ?? undefined,
      hub: asFlag(body.hub) ?? latest.lfHub,
      hfEndpoint: asFlag(body.hfEndpoint) ?? latest.lfHfEndpoint,
    });
    if (result.cancelled) return;
    if (result.code !== 0) throw new Error(`llamafactory-cli 退出码 ${result.code}`);
  },
};

function inferJobBackend(body: Record<string, unknown>): string {
  if (body.baseline === true) return "rule";
  const backend = asFlag(body.backend);
  if (backend === "http" || backend === "file" || backend === "llamafactory") return backend;
  return "llamafactory";
}

const inferCommand: JobCommand = {
  name: "infer",
  async validate(app, body) {
    const cfg = await loadUserConfig({ command: "infer", cwd: app.dataRoot() });
    const gold = cfg.paths.eval;
    if (!fs.existsSync(gold)) {
      return `没有验证集 ${gold}，请先在「数据生成」页生成验证集`;
    }
    const backend = inferJobBackend(body);
    if (backend === "llamafactory") {
      const detect = detectLlamaFactory({
        home: asFlag(body.home) ?? cfg.lfHome,
        bin: asFlag(body.bin) ?? cfg.lfBin,
      });
      if (!detect.ok) return detect.errors.join("\n");
    }
    if (backend === "http" && !asFlag(body.url) && !cfg.infer.http?.url) {
      return "http 推理需要填写接口 URL";
    }
    return null;
  },
  async execute(app, job, body) {
    const backend = inferJobBackend(body);
    const adapter = asFlag(body.adapter);
    const raw = app.readConfigFile();
    const prevTrain = isJsonObject(raw.train) ? raw.train : {};
    const prevInfer = isJsonObject(raw.infer) ? raw.infer : {};
    app.writeConfigFile({
      ...raw,
      infer: { ...prevInfer, backend },
      ...(adapter
        ? { train: { ...prevTrain, outputDir: adapter } }
        : {}),
    });
    const cfg = await loadUserConfig({ command: "infer", cwd: app.dataRoot() });
    await infer(cfg, {
      backend,
      url: asFlag(body.url),
      model: asFlag(body.model),
      adapter,
      home: asFlag(body.home) ?? cfg.lfHome ?? undefined,
      bin: asFlag(body.bin) ?? cfg.lfBin ?? undefined,
      hub: asFlag(body.hub) ?? cfg.lfHub,
      all: body.all !== false,
      signal: job.signal,
      onLog: job.onLog,
    });
    evaluate(cfg, { all: true });
    job.onLog("[infer] 已根据预测计算指标（reports/metrics.json）");
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

function resolveInstallHome(root: string, home: string): string {
  return path.isAbsolute(home) ? path.resolve(home) : path.resolve(root, home);
}

const lfInstallCommand: JobCommand = {
  name: "lf-install",
  async validate(app, body) {
    const script = locateInstallScript();
    if (script) {
      if (!findBash()) return "未找到 bash。安装脚本需要 Git Bash 或 WSL。";
      if (!findGit()) return "未找到 git。安装脚本克隆仓库需要 Git。";
      return null;
    }
    const home = asFlag(body.home)?.trim();
    if (!home) return "未找到安装脚本，请填写 LlamaFactory 安装目录";
    if (!findSystemPython()) {
      return "未找到可用 Python。请先安装 Python 3.10+，不要使用 Microsoft Store 占位的 python.exe。";
    }
    const resolved = resolveInstallHome(app.dataRoot(), home);
    const exists = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
    const empty =
      !exists || fs.readdirSync(resolved).filter((name) => name !== "." && name !== "..").length === 0;
    if (exists && !empty && !looksLikeLlamaFactoryHome(resolved)) {
      return `目录已有其它文件，不能安装到: ${resolved}`;
    }
    if ((!exists || empty) && !findGit()) {
      return "未找到 git。首次安装需要用 git 克隆 LLaMA-Factory。";
    }
    return null;
  },
  async execute(app, job, body) {
    const home = asFlag(body.home)?.trim();
    const result = await installLlamaFactory({
      scriptRoot: app.dataRoot(),
      home: home ? resolveInstallHome(app.dataRoot(), home) : undefined,
      torchCuda: asFlag(body.torchCuda) ?? "auto",
      pipIndexUrl: asFlag(body.pipIndexUrl) ?? "https://mirrors.aliyun.com/pypi/simple",
      pythonVersion: asFlag(body.pythonVersion) ?? "3.11",
      branch: asFlag(body.branch),
      signal: job.signal,
      onLog: job.onLog,
    });
    const root = app.dataRoot();
    const rel = path.relative(root, result.home);
    persistLlamaFactory(app, {
      home: rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.replaceAll("\\", "/") : result.home,
      bin: "",
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
  lfInstallCommand,
];

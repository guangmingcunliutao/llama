/**
 * 内置长任务。扩展时新增一个 JobCommand 并加入 JOB_COMMANDS。
 */
import fs from "node:fs";
import path from "node:path";
import {
  analyze,
  createRun,
  detectLlamaFactory,
  detectQuantTools,
  evaluate,
  findBash,
  findEvalRunWithPred,
  findGit,
  findSystemPython,
  generate,
  generateEval,
  hasEvalGold,
  infer,
  installLlamaFactory,
  loadUserConfig,
  loadWorkspace,
  locateInstallScript,
  looksLikeLlamaFactoryHome,
  patchWorkspace,
  quantizeSource,
  readRun,
  requireDataRun,
  startTrainFromConfig,
  summarizeRun,
  trainRunPaths,
  validateModelSource,
} from "@model-training/core";
import { asFlag, asStringList, isJsonObject } from "../api/envelope.js";
import { persistGeneratePatch, persistLlamaFactory, persistQuant, trainPatch, type AppContext } from "../appContext.js";
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
      mode: asFlag(body.mode) as "fresh" | "resume" | "continue" | undefined,
      runId: asFlag(body.runId),
      parentId: asFlag(body.parentId),
      label: asFlag(body.label),
      signal: job.signal,
    });
  },
};

const generateEvalCommand: JobCommand = {
  name: "generate-eval",
  async validate(app) {
    const cfg = await loadUserConfig({ command: "generate-eval", cwd: app.dataRoot() });
    const ws = loadWorkspace(cfg.outDir);
    try {
      const data = requireDataRun(cfg.outDir, ws.dataRunId);
      if (!fs.existsSync(data.paths.train)) return `没有训练集 ${data.paths.train}，请先生成训练数据`;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
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
      mode: asFlag(body.mode) as "fresh" | "resume" | "continue" | undefined,
      runId: asFlag(body.runId),
      signal: job.signal,
    });
  },
};

const trainCommand: JobCommand = {
  name: "train",
  async validate(app, body) {
    const cfg = await loadUserConfig({ command: "train", cwd: app.dataRoot() });
    const mode = asFlag(body.mode) ?? "fresh";
    if (mode !== "resume") {
      const dataId = asFlag(body.dataRunId) ?? loadWorkspace(cfg.outDir).dataRunId;
      try {
        const data = requireDataRun(cfg.outDir, dataId);
        if (!fs.existsSync(data.paths.train)) return `没有训练句子 ${data.paths.train}，请先在「数据」页生成`;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
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
    if (mode === "resume" || mode === "continue") {
      const ws = loadWorkspace(cfg.outDir);
      const id = mode === "resume"
        ? asFlag(body.runId) ?? ws.trainRunId
        : asFlag(body.parentId) ?? ws.trainRunId;
      if (!id) return mode === "resume" ? "请先点选要继续的训练实验" : "请先点选上一份训练实验";
      const meta = readRun(cfg.outDir, "train", id);
      if (!meta) return `找不到训练实验 ${id}`;
      const sum = summarizeRun(cfg.outDir, meta);
      if (mode === "resume" && !sum.canResume) {
        return sum.resumeHint || "没有 checkpoint，无法继续未完成训练。把保存步长调小后再训，中断才接得上。";
      }
      if (mode === "continue" && !sum.adapterReady) {
        return "上一份还没有 LoRA。需要至少保存过一份 checkpoint，或已经训完。";
      }
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
      mode: asFlag(body.mode),
      runId: asFlag(body.runId),
      parentId: asFlag(body.parentId),
      dataRunId: asFlag(body.dataRunId),
      label: asFlag(body.label),
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
    const ws = loadWorkspace(cfg.outDir);
    const dataId = asFlag(body.dataRunId) ?? ws.dataRunId;
    try {
      const data = requireDataRun(cfg.outDir, dataId);
      if (!hasEvalGold(data.paths)) {
        return `没有验证集 ${data.paths.eval}，请先在「数据生成」页生成验证集`;
      }
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
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
    const raw = app.readConfigFile();
    const prevInfer = isJsonObject(raw.infer) ? raw.infer : {};
    app.writeConfigFile({
      ...raw,
      infer: { ...prevInfer, backend },
    });
    const latest0 = await loadUserConfig({ command: "infer", cwd: app.dataRoot() });
    const ws = loadWorkspace(latest0.outDir);
    const trainId = asFlag(body.trainRunId) ?? ws.trainRunId;
    const dataId = asFlag(body.dataRunId) ?? ws.dataRunId;
    if (trainId) {
      const evalRun = createRun(latest0.outDir, {
        kind: "eval",
        mode: "fresh",
        label: asFlag(body.label) || "eval",
        extra: { trainRunId: trainId, dataRunId: dataId },
      });
      patchWorkspace(latest0.outDir, {
        evalRunId: evalRun.id,
        trainRunId: trainId,
        dataRunId: dataId ?? ws.dataRunId,
      });
    }
    const adapter =
      asFlag(body.adapter) || (trainId ? trainRunPaths(latest0.outDir, trainId).ckpt : undefined);
    const cfg = await loadUserConfig({ command: "infer", cwd: app.dataRoot() });
    let inferErr: unknown = null;
    try {
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
    } catch (err) {
      inferErr = err;
      job.onLog(`[infer] 推理中断: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      evaluate(cfg, { all: true });
      job.onLog("[infer] 已根据预测计算指标（reports/metrics.json）");
    } catch (evalErr) {
      if (inferErr) throw inferErr;
      throw evalErr;
    }
    if (inferErr) throw inferErr;
  },
};

const evaluateCommand: JobCommand = {
  name: "evaluate",
  async validate(app) {
    const cfg = await loadUserConfig({ command: "evaluate", cwd: app.dataRoot() });
    const ws = loadWorkspace(cfg.outDir);
    try {
      const data = requireDataRun(cfg.outDir, ws.dataRunId);
      if (!hasEvalGold(data.paths)) {
        return `没有验证集 ${data.paths.eval}，请先在「数据生成」页生成验证集`;
      }
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    const predId = findEvalRunWithPred(cfg.outDir, {
      preferId: ws.evalRunId,
      dataRunId: ws.dataRunId,
      trainRunId: ws.trainRunId,
    });
    if (!predId) {
      return "当前没有预测文件。请先点「开始评估」生成预测，或点「规则上界」对照。";
    }
    return null;
  },
  async execute(app, job) {
    const latest0 = await loadUserConfig({ command: "evaluate", cwd: app.dataRoot() });
    const ws = loadWorkspace(latest0.outDir);
    const predId = findEvalRunWithPred(latest0.outDir, {
      preferId: ws.evalRunId,
      dataRunId: ws.dataRunId,
      trainRunId: ws.trainRunId,
    });
    if (predId && predId !== ws.evalRunId) {
      patchWorkspace(latest0.outDir, { evalRunId: predId });
      job.onLog(`[evaluate] 当前评估实验没有预测，改用 ${predId}`);
    }
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

const quantCommand: JobCommand = {
  name: "quant",
  async validate(app, body) {
    const source = asFlag(body.source)?.trim();
    if (!source) return "请填写源模型路径（GGUF 或合并后的 HuggingFace 目录）";
    const cfg = await loadUserConfig({ command: "quant", cwd: app.dataRoot() });
    const tools = detectQuantTools({
      llamaHome: asFlag(body.llamaHome) ?? asFlag(body.llamaQuantize) ?? cfg.quantHome,
      llamaQuantize: cfg.quantBin,
      convertScript: asFlag(body.convertScript) ?? cfg.quantConvertScript,
      lfHome: cfg.lfHome,
    });
    if (!tools.ok) return tools.notes.join("\n");
    persistQuant(app, {
      llamaHome: asFlag(body.llamaHome) ?? asFlag(body.llamaQuantize),
      convertScript: asFlag(body.convertScript),
    });
    return null;
  },
  async execute(app, job, body) {
    persistQuant(app, {
      llamaHome: asFlag(body.llamaHome) ?? asFlag(body.llamaQuantize),
      convertScript: asFlag(body.convertScript),
    });
    const latest = await loadUserConfig({ command: "quant", cwd: app.dataRoot() });
    const formats = [
      ...(asStringList(body.formats) ?? []),
      ...(asFlag(body.custom)?.split(/[,，\s]+/) ?? []),
    ].filter(Boolean);
    await quantizeSource(latest, {
      source: asFlag(body.source) ?? "",
      formats,
      dtype: asFlag(body.dtype) ?? "f16",
      requant: body.requant === true,
      keepMid: body.keepMid === true,
      llamaHome: asFlag(body.llamaHome) ?? asFlag(body.llamaQuantize) ?? latest.quantHome,
      llamaQuantize: latest.quantBin,
      convertScript: asFlag(body.convertScript) ?? latest.quantConvertScript,
      outDir: asFlag(body.outDir),
      trainRunId: asFlag(body.trainRunId),
      signal: job.signal,
      onLog: job.onLog,
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
  quantCommand,
  lfInstallCommand,
];

import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import {
  analyze,
  defaultUserConfig,
  evaluate,
  findRepoRoot,
  generate,
  generateEval,
  infer,
  loadUserConfig,
  parseTrainYaml,
  startTrainFromConfig,
} from "@model-training/core";
import { datasetStatus, saveSeedAndPrepare } from "./datasets.js";
import { createJobHub } from "./jobs.js";

function dataRoot(): string {
  return process.env.MODEL_TRAINING_DATA || findRepoRoot(process.cwd());
}

function configPath(): string {
  return path.join(dataRoot(), "model-training.config.json");
}

function listenHost(): string {
  return process.env.MODEL_TRAINING_HOST || "127.0.0.1";
}

function listenPort(): number {
  const raw = process.env.MODEL_TRAINING_PORT;
  const n = raw ? Number(raw) : 5000;
  return Number.isFinite(n) ? n : 5000;
}

function findWebDist(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../web/dist"),
    path.resolve(process.cwd(), "packages/web/dist"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

function readConfigFile(): unknown {
  const file = configPath();
  if (!fs.existsSync(file)) {
    const created = defaultUserConfig();
    fs.writeFileSync(file, `${JSON.stringify(created, null, 2)}\n`, "utf8");
    return created;
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

async function main(): Promise<void> {
  const app = Fastify({ logger: true });
  const jobs = createJobHub();
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 80 * 1024 * 1024 } });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/config", async () => ({ ok: true, data: readConfigFile() }));

  app.put("/api/config", async (request, reply) => {
    const body = request.body;
    if (body == null || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ ok: false, error: "配置必须是 JSON 对象" });
    }
    const file = configPath();
    fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    return { ok: true, data: body };
  });

  app.get("/api/jobs", async () => jobs.snapshot());

  app.get("/api/datasets", async () => {
    readConfigFile();
    return { ok: true, data: await datasetStatus(dataRoot()) };
  });

  app.post("/api/upload/seed", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ ok: false, error: "请选择种子文件" });
    readConfigFile();
    const cfg = await loadUserConfig({ command: "prepare", cwd: dataRoot() });
    if (!cfg.dict) return reply.code(400).send({ ok: false, error: "配置里没有 dict 路径" });
    const uploads = path.join(dataRoot(), "uploads");
    fs.mkdirSync(uploads, { recursive: true });
    const safeName = path.basename(file.filename).replace(/[^\w.\u4e00-\u9fa5-]/g, "_");
    const tmpFile = path.join(uploads, safeName || "seed.xlsx");
    await pipeline(file.file, fs.createWriteStream(tmpFile));
    const result = saveSeedAndPrepare({
      cwd: dataRoot(),
      dictPath: cfg.dict,
      tmpFile,
      originalName: file.filename,
    });
    return { ok: true, ...result, data: await datasetStatus(dataRoot()) };
  });

  app.post("/api/jobs/cancel", async () => {
    jobs.cancel();
    return jobs.snapshot();
  });

  app.post("/api/jobs/generate", async (request, reply) => {
    readConfigFile();
    const cfg = await loadUserConfig({ command: "generate", cwd: dataRoot() });
    if (!cfg.dict || !fs.existsSync(cfg.dict)) {
      return reply.code(400).send({
        ...jobs.snapshot(),
        ok: false,
        busy: false,
        error: "还没有词对字典，请先上传种子文件",
      });
    }
    const body = isJsonObject(request.body) ? request.body : {};
    try {
      jobs.start("generate", async () => {
        persistGeneratePatch(body);
        const latest = await loadUserConfig({ command: "generate", cwd: dataRoot() });
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
      });
      return jobs.snapshot();
    } catch (err) {
      return reply.code(409).send({ ...jobs.snapshot(), ok: false, error: errMessage(err) });
    }
  });

  app.post("/api/jobs/generate-eval", async (_request, reply) => {
    readConfigFile();
    const cfg = await loadUserConfig({ command: "generate-eval", cwd: dataRoot() });
    if (!fs.existsSync(cfg.paths.sft)) {
      return reply.code(400).send({
        ...jobs.snapshot(),
        ok: false,
        busy: false,
        error: `没有训练集 ${cfg.paths.sft}，请先生成训练数据`,
      });
    }
    try {
      jobs.start("generate-eval", async () => {
        const latest = await loadUserConfig({ command: "generate-eval", cwd: dataRoot() });
        await generateEval(latest);
      });
      return jobs.snapshot();
    } catch (err) {
      return reply.code(409).send({ ...jobs.snapshot(), ok: false, error: errMessage(err) });
    }
  });

  app.post("/api/jobs/train", async (_request, reply) => {
    readConfigFile();
    const cfg = await loadUserConfig({ command: "train", cwd: dataRoot() });
    if (!fs.existsSync(cfg.paths.sft)) {
      return reply.code(400).send({
        ...jobs.snapshot(),
        ok: false,
        busy: false,
        error: `没有训练集 ${cfg.paths.sft}，请先在「数据生成」页生成`,
      });
    }
    try {
      jobs.start("train", async (ctx) => {
        const latest = await loadUserConfig({ command: "train", cwd: dataRoot() });
        const patch = trainPatch(_request.body);
        const result = await startTrainFromConfig(latest, {
          signal: ctx.signal,
          onLog: ctx.onLog,
          patch,
        });
        if (result.cancelled) return;
        if (result.code !== 0) throw new Error(`llamafactory-cli 退出码 ${result.code}`);
      });
      return jobs.snapshot();
    } catch (err) {
      return reply.code(409).send({ ...jobs.snapshot(), ok: false, error: errMessage(err) });
    }
  });

  app.post("/api/jobs/infer", async (request, reply) => {
    readConfigFile();
    const body = isJsonObject(request.body) ? request.body : {};
    try {
      jobs.start("infer", async () => {
        const latest = await loadUserConfig({ command: "infer", cwd: dataRoot() });
        await infer(latest, {
          backend: asFlag(body.backend),
          url: asFlag(body.url),
          model: asFlag(body.model),
          all: body.all === true,
        });
      });
      return jobs.snapshot();
    } catch (err) {
      return reply.code(409).send({ ...jobs.snapshot(), ok: false, error: errMessage(err) });
    }
  });

  app.post("/api/jobs/evaluate", async (_request, reply) => {
    readConfigFile();
    try {
      jobs.start("evaluate", async () => {
        const latest = await loadUserConfig({ command: "evaluate", cwd: dataRoot() });
        evaluate(latest, { all: true });
      });
      return jobs.snapshot();
    } catch (err) {
      return reply.code(409).send({ ...jobs.snapshot(), ok: false, error: errMessage(err) });
    }
  });

  app.post("/api/jobs/analyze", async (request, reply) => {
    readConfigFile();
    const body = isJsonObject(request.body) ? request.body : {};
    try {
      jobs.start("analyze", async () => {
        const latest = await loadUserConfig({ command: "analyze", cwd: dataRoot() });
        analyze(latest, {
          dir: asFlag(body.dir),
          trainConfig: asFlag(body.trainConfig),
          name: asFlag(body.name),
          note: asFlag(body.note),
          save: body.save === true,
          compare: body.compare === true,
          force: body.force === true,
        });
      });
      return jobs.snapshot();
    } catch (err) {
      return reply.code(409).send({ ...jobs.snapshot(), ok: false, error: errMessage(err) });
    }
  });

  app.get("/api/reports", async () => {
    readConfigFile();
    const cfg = await loadUserConfig({ command: "status", cwd: dataRoot() });
    return {
      ok: true,
      data: {
        metrics: readJsonIfExists(cfg.paths.metrics),
        analysis: readTextIfExists(cfg.paths.analysis),
        compare: readTextIfExists(cfg.paths.compare),
        trainYaml: cfg.trainConfig,
        trainKnobs: cfg.trainConfig && fs.existsSync(cfg.trainConfig)
          ? parseTrainYaml(fs.readFileSync(cfg.trainConfig, "utf8"))
          : parseTrainYaml(fs.existsSync(path.join(cfg.outDir, "llamafactory", "train_sft.yaml"))
              ? fs.readFileSync(path.join(cfg.outDir, "llamafactory", "train_sft.yaml"), "utf8")
              : ""),
      },
    };
  });

  app.get("/api/quant/detect", async (request) => {
    const q = request.query as { path?: string };
    const target = String(q.path ?? "").trim();
    if (!target) return { ok: false, error: "缺少 path" };
    const exists = fs.existsSync(target);
    let kind = "missing";
    if (exists) {
      const st = fs.statSync(target);
      if (st.isDirectory()) kind = "hf-dir";
      else if (target.toLowerCase().endsWith(".gguf")) kind = "gguf";
      else kind = "file";
    }
    return { ok: true, exists, kind, path: target };
  });

  const webDist = findWebDist();
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) {
        return reply.code(404).send({ ok: false, error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.log.warn("未找到 @model-training/web 的 dist，仅提供 /api。请先 pnpm --filter @model-training/web build");
  }

  const host = listenHost();
  const port = listenPort();
  await app.listen({ host, port });
  app.log.info(`model-training webui http://${host}:${port}`);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asFlag(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  return String(value);
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map((item) => String(item)).filter(Boolean);
  return out.length ? out : undefined;
}

function persistGeneratePatch(body: Record<string, unknown>): void {
  const file = configPath();
  const raw = readConfigFile();
  if (!isJsonObject(raw)) return;
  const next: Record<string, unknown> = { ...raw };
  if (body.pairsPerTerm != null) next.pairsPerTerm = Number(body.pairsPerTerm);
  if (body.limitTerms != null || body.maxWords != null) {
    const n = Number(body.limitTerms ?? body.maxWords);
    next.limitTerms = n > 0 ? n : null;
  }
  if (body.cleanRatio != null) {
    const n = Number(body.cleanRatio);
    next.cleanRatio = n > 1 ? n / 100 : n;
  }
  if (body.maxPages != null) next.maxPages = Number(body.maxPages);
  if (typeof body.instruction === "string" && body.instruction.trim()) next.instruction = body.instruction;
  if (typeof body.format === "string" && body.format.trim()) {
    next.formats = body.format.split(/[,+\s]+/).filter(Boolean);
  }
  if (isJsonObject(body.sentence)) {
    next.sentence = { ...(isJsonObject(raw.sentence) ? raw.sentence : {}), ...body.sentence };
  }
  if (isJsonObject(body.rate)) {
    next.rate = { ...(isJsonObject(raw.rate) ? raw.rate : {}), ...body.rate };
  }
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function trainPatch(body: unknown): Record<string, string | number | boolean> | undefined {
  if (!isJsonObject(body) || !isJsonObject(body.knobs)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(body.knobs)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

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

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

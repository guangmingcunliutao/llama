/**
 * 对评估集推理。
 * rule：按词对替换，作为对照基线。
 * llamafactory：本机 LlamaFactory batch predict。
 * http：OpenAI 兼容 chat/completions。
 * file：只把样本落到 pred 路径。
 */
import fs from "node:fs";
import { listEvalSlices } from "./evaluate.js";
import { readJsonOrJsonl, writeJsonl } from "./jsonl.js";
import type { InferBackend, InferFlags, PredictionRow, ResolvedConfig, SftExample } from "./types.js";
import { inferLlamaFactorySlice } from "./inferLf.js";

function asBackend(value: string | undefined, fallback: InferBackend): InferBackend {
  if (value === "rule" || value === "http" || value === "file" || value === "llamafactory") return value;
  if (!value) return fallback;
  throw new Error(`未知推理后端 ${value}，可选 rule / llamafactory / http / file`);
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  output?: string;
  text?: string;
}

function rulePred(g: SftExample): string {
  return g.wrong && g.correct ? String(g.input || "").split(g.wrong).join(g.correct) : g.output;
}

async function httpPred(
  g: SftExample,
  url: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const instruction = g.instruction || "";
  const input = g.input || "";
  const messages = instruction
    ? [
        { role: "system", content: instruction },
        { role: "user", content: input },
      ]
    : [{ role: "user", content: input }];
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`http 推理失败 HTTP ${res.status}`);
  const data = (await res.json()) as ChatCompletionResponse;
  return String(data.choices?.[0]?.message?.content || data.output || data.text || "").trim();
}

async function inferFile(
  cfg: ResolvedConfig,
  input: string,
  output: string,
  backend: InferBackend,
  flags: InferFlags,
): Promise<string> {
  const samples = readJsonOrJsonl<SftExample>(input);

  if (backend === "llamafactory") {
    return inferLlamaFactorySlice(cfg, input, output, flags);
  }

  if (backend === "file") {
    writeJsonl(output, samples);
    console.log(`[infer] backend=file 已写出待推理样本 ${samples.length} -> ${output}`);
    return output;
  }

  const preds: PredictionRow[] = [];
  if (backend === "rule") {
    console.log(
      "[infer] 规则基线：按词对把错词换成正词，不加载训练模型。要用 LoRA/基座请把后端改成 LlamaFactory。",
    );
    for (const [i, g] of samples.entries()) {
      preds.push({ id: g.id ?? i, pred: rulePred(g) });
    }
  } else {
    const url = flags.url || cfg.infer.http?.url;
    const model = flags.model || cfg.infer.http?.model || "default";
    const envName = cfg.infer.http?.apiKeyEnv || cfg.infer.http?.api_key_env || "OPENAI_API_KEY";
    const apiKey = process.env[envName] || "";
    if (!url) throw new Error("http 推理需要配置 infer.http.url");
    for (const [i, g] of samples.entries()) {
      const pred = await httpPred(g, url, model, apiKey);
      preds.push({ id: g.id ?? i, pred });
    }
  }

  writeJsonl(output, preds);
  console.log(`[infer] backend=${backend} n=${preds.length} -> ${output}`);
  return output;
}

/** 写出 infer/pred.jsonl，每行 {id, pred}。`--all` 时对所有评估切片各写一份。 */
export async function infer(cfg: ResolvedConfig, flags: InferFlags = {}): Promise<string> {
  const backend = asBackend(flags.backend, "llamafactory");
  if (flags.all) {
    const paths: string[] = [];
    for (const slice of listEvalSlices(cfg)) {
      if (!fs.existsSync(slice.gold)) continue;
      paths.push(await inferFile(cfg, slice.gold, slice.pred, backend, flags));
    }
    if (!paths.length) throw new Error("infer --all 没有找到评估集。请先执行 mtrain split 或 generate-eval。");
    return paths[0]!;
  }
  const input = flags.input || cfg.paths.eval;
  const output = flags.output || cfg.paths.pred;
  return inferFile(cfg, input, output, backend, flags);
}

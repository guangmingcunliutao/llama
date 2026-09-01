/**
 * SFT 导出格式。
 *
 * alpaca：instruction / input / output，划分和评估都用这个（带 wrong/correct）。
 * sharegpt：LlamaFactory `formatting: "sharegpt"`，instruction 放 system，对话为 human → gpt。
 */
import type { SftExample, SftFormat } from "./types.js";

export interface ShareGptTurn {
  from: "human" | "gpt";
  value: string;
}

/** 一条 ShareGPT 样本；多余字段 LlamaFactory 会忽略，留给对照和排查。 */
export interface ShareGptExample {
  system: string;
  conversations: ShareGptTurn[];
  error_type?: string;
  wrong?: string;
  correct?: string;
  source?: string;
  url?: string;
  article_id?: string;
  split?: string;
  id?: string | number;
}

export function toShareGpt(row: SftExample): ShareGptExample {
  return {
    system: row.instruction,
    conversations: [
      { from: "human", value: row.input },
      { from: "gpt", value: row.output },
    ],
    error_type: row.error_type,
    wrong: row.wrong,
    correct: row.correct,
    source: row.source,
    url: row.url,
    article_id: row.article_id,
    id: row.id,
    split: row.split,
  };
}

export function toMessages(row: SftExample): {
  id?: string | number;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
} {
  return {
    id: row.id,
    messages: [
      { role: "system", content: row.instruction },
      { role: "user", content: row.input },
      { role: "assistant", content: row.output },
    ],
  };
}

export function parseFormats(raw: unknown, fallback: SftFormat[] = ["messages"]): SftFormat[] {
  let tokens: string[] = [];
  if (raw == null || raw === "") tokens = [...fallback];
  else if (Array.isArray(raw)) tokens = raw.map((item) => String(item));
  else tokens = String(raw).split(/[,+\s]+/);

  const out: SftFormat[] = [];
  for (const token of tokens) {
    const value = token.trim().toLowerCase();
    if (!value) continue;
    if (value !== "alpaca" && value !== "sharegpt" && value !== "messages") {
      throw new Error(`未知 SFT 格式 ${value}，可选 alpaca / sharegpt / messages`);
    }
    if (!out.includes(value)) out.push(value);
  }
  if (!out.length) return [...fallback];
  return out;
}

export function wantsShareGpt(formats: SftFormat[]): boolean {
  return formats.includes("sharegpt");
}

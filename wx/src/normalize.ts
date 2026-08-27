/**
 * 将任意 SFT 样本（alpaca / sharegpt / LlamaFactory conversations）规范为 SftExample。
 * 划分与评估以 alpaca 语义为准；导出时可再转为 sharegpt。
 */
import fs from "node:fs";
import type { SftExample } from "./types.js";
import { isRecord } from "./util.js";

const DEFAULT_PREFIX = /输入句子为[：:]\s*/;

export interface NormalizeOptions {
  instruction?: string;
}

function clean(text: string): string {
  return String(text || "").trim();
}

/** 从 LlamaFactory human 整段 prompt 里抽出错句。 */
export function extractWrongSentence(human: string): string {
  const text = clean(human);
  const idx = text.search(DEFAULT_PREFIX);
  if (idx >= 0) {
    return clean(text.slice(idx).replace(DEFAULT_PREFIX, ""));
  }
  return text;
}

/** 推断错误类型（语法纠错无词典时的粗分类）。 */
export function inferErrorType(input: string, output: string): string {
  const a = clean(input);
  const b = clean(output);
  if (a === b) return "keep";
  const stripPunct = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");
  if (stripPunct(a) === stripPunct(b)) return "punctuation";
  if (Math.abs(a.length - b.length) / Math.max(a.length, b.length, 1) > 0.35) return "rewrite";
  if (/[\u4e00-\u9fff]/.test(a) !== /[\u4e00-\u9fff]/.test(b)) return "mixed_script";
  return "grammar";
}

/** 尝试从 input/output 差异推断 wrong/correct 片段（供 term_fix 类指标参考）。 */
export function inferWrongCorrect(input: string, output: string): { wrong: string; correct: string } {
  const a = clean(input);
  const b = clean(output);
  if (!a || !b || a === b) return { wrong: "", correct: "" };
  // 最长公共前缀 / 后缀，中间差当作 wrong→correct
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre += 1;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  ) {
    suf += 1;
  }
  const wrong = clean(a.slice(pre, a.length - suf));
  const correct = clean(b.slice(pre, b.length - suf));
  if (!wrong || !correct || wrong.length > 40 || correct.length > 40) {
    return { wrong: "", correct: "" };
  }
  return { wrong, correct };
}

export function pairKeyForRow(row: Pick<SftExample, "wrong" | "correct" | "input" | "output">): string {
  const w = clean(row.wrong);
  const c = clean(row.correct);
  if (w || c) return `${w}\t${c}`;
  const inp = clean(row.input);
  const out = clean(row.output);
  return `${inp}\t${out}`;
}

function fromAlpaca(raw: Record<string, unknown>, opts: NormalizeOptions): SftExample | null {
  const instruction = clean(String(raw.instruction ?? raw.prompt ?? opts.instruction ?? ""));
  const inputRaw = clean(String(raw.input ?? raw.query ?? ""));
  const output = clean(String(raw.output ?? raw.response ?? raw.target ?? ""));
  if (!inputRaw && !output) return null;
  const input = inputRaw.includes("输入句子为") ? extractWrongSentence(inputRaw) : inputRaw;
  const { wrong, correct } = inferWrongCorrect(input, output);
  return {
    instruction: instruction || opts.instruction || "",
    input,
    output,
    error_type: clean(String(raw.error_type ?? raw.errorType ?? inferErrorType(input, output))),
    wrong: clean(String(raw.wrong ?? raw.error ?? wrong)),
    correct: clean(String(raw.correct ?? raw.ok ?? correct)),
    source: clean(String(raw.source ?? "import")),
    url: clean(String(raw.url ?? "")),
    article_id: clean(String(raw.article_id ?? raw.articleId ?? "")),
    id: raw.id as string | number | undefined,
    split: raw.split as string | undefined,
  };
}

function fromShareGpt(raw: Record<string, unknown>, opts: NormalizeOptions): SftExample | null {
  const system = clean(String(raw.system ?? ""));
  const conv = raw.conversations ?? raw.messages;
  if (!Array.isArray(conv) || conv.length < 2) return null;
  const human = conv.find(
    (t: unknown) => isRecord(t) && (t.from === "human" || t.role === "user"),
  );
  const gpt = conv.find(
    (t: unknown) => isRecord(t) && (t.from === "gpt" || t.from === "assistant" || t.role === "assistant"),
  );
  if (!isRecord(human) || !isRecord(gpt)) return null;
  const humanVal = clean(String(human.value ?? human.content ?? ""));
  const output = clean(String(gpt.value ?? gpt.content ?? ""));
  const instruction = system || opts.instruction || "";
  const input = extractWrongSentence(humanVal);
  const { wrong, correct } = inferWrongCorrect(input, output);
  return {
    instruction,
    input,
    output,
    error_type: clean(String(raw.error_type ?? inferErrorType(input, output))),
    wrong: clean(String(raw.wrong ?? wrong)),
    correct: clean(String(raw.correct ?? correct)),
    source: clean(String(raw.source ?? "import")),
    url: clean(String(raw.url ?? "")),
    article_id: clean(String(raw.article_id ?? "")),
    id: raw.id as string | number | undefined,
    split: raw.split as string | undefined,
  };
}

/** 单条原始 JSON 转为 SftExample；无法识别时返回 null。 */
export function normalizeRow(raw: unknown, opts: NormalizeOptions = {}): SftExample | null {
  if (!isRecord(raw)) return null;
  if (Array.isArray(raw.conversations) || Array.isArray(raw.messages)) {
    return fromShareGpt(raw, opts);
  }
  if ("instruction" in raw || "input" in raw || "query" in raw || "output" in raw || "response" in raw) {
    return fromAlpaca(raw, opts);
  }
  return null;
}

/** 流式读取 jsonl / 大 json（按行），可选 limit。 */
export function readDatasetRows(file: string, limit?: number | null): unknown[] {
  const stat = fs.statSync(file);
  const out: unknown[] = [];
  const chunks: string[] = [];
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(1024 * 1024);
  let leftover = "";
  let bytes = 0;
  while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
    leftover += buf.toString("utf8", 0, bytes);
    let nl = leftover.indexOf("\n");
    while (nl >= 0) {
      const line = leftover.slice(0, nl).trim();
      leftover = leftover.slice(nl + 1);
      if (line) chunks.push(line);
      nl = leftover.indexOf("\n");
    }
    if (limit != null && limit > 0 && chunks.length >= limit) break;
  }
  fs.closeSync(fd);
  if (leftover.trim()) chunks.push(leftover.trim());

  // 小文件且整段是 JSON 数组
  if (stat.size < 50_000_000 && chunks.length === 1 && chunks[0]?.trim().startsWith("[")) {
    try {
      const data = JSON.parse(chunks[0]) as unknown;
      if (Array.isArray(data)) {
        return limit != null && limit > 0 ? data.slice(0, limit) : data;
      }
    } catch {
      /* line mode */
    }
  }

  for (const line of chunks) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as unknown);
    } catch {
      /* skip bad line */
    }
    if (limit != null && limit > 0 && out.length >= limit) break;
  }
  return out;
}

export function normalizeRows(rows: unknown[], opts: NormalizeOptions = {}): SftExample[] {
  const out: SftExample[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const row = normalizeRow(raw, opts);
    if (!row || !row.input || !row.output) continue;
    const key = `${row.input}\t${row.output}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** 导出为 LlamaFactory sharegpt 单条。 */
export function toLfShareGpt(row: SftExample, instruction?: string): Record<string, unknown> {
  const base = instruction || row.instruction || "你是一个文本纠错专家，纠正输入句子中的语法错误，并输出正确的句子，输入句子为：";
  const prefix = base.endsWith("：") || base.endsWith(":") ? base : `${base}：`;
  return {
    conversations: [
      { from: "human", value: `${prefix}${row.input}` },
      { from: "gpt", value: row.output },
    ],
  };
}

/** 导出为 LlamaFactory alpaca 单条。 */
export function toLfAlpaca(row: SftExample): Record<string, unknown> {
  return {
    instruction: row.instruction,
    input: row.input,
    output: row.output,
    id: row.id,
    error_type: row.error_type,
    wrong: row.wrong,
    correct: row.correct,
    split: row.split,
  };
}

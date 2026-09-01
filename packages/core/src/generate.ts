/**
 * 生成 SFT 句对：用正确词检索权威正文，切句后把正确词换成错误词。
 *
 * 输出追加写入 outDir/sft/train.jsonl（alpaca）。若启用 sharegpt，结束时再镜像一份 train_sharegpt.jsonl。
 * 同一正确词只检索一次，再展开到它对应的全部错误词。
 * 多条样本按搜索结果从上往下、每条结果取一句，不把第一篇抽干。
 * 远程 HTTP 的频率限制在源内部、真正发请求前触发（缓存命中不限速）。
 */
import fs from "node:fs";
import path from "node:path";
import { groupByCorrect, loadDictionary } from "./dictionary.js";
import { parseFormats, toShareGpt, wantsShareGpt } from "./format.js";
import { cleanSampleCount } from "./generateMix.js";
import { readJsonl, writeJsonl } from "./jsonl.js";
import { RequestRateLimiter } from "./rateLimit.js";
import { goodSentence, splitSentences } from "./text.js";
import { buildSource, selectSources } from "./sources/registry.js";
import { normalizeSentence } from "./sentenceNorm.js";
import type {
  GenerateFlags,
  GenerateResult,
  ResolvedConfig,
  SftExample,
  SourceDocument,
} from "./types.js";

interface SentenceHit {
  sent: string;
  doc: SourceDocument;
}

function loadDoneKeys(outFile: string): Set<string> {
  const keys = new Set<string>();
  if (!fs.existsSync(outFile)) return keys;
  const text = fs.readFileSync(outFile, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Partial<SftExample>;
      keys.add(`${row.wrong}\t${row.correct}\t${row.output}`);
    } catch {
      /* 跳过损坏行 */
    }
  }
  return keys;
}

/**
 * 按检索结果列表从上往下取句：每条结果最多一句（该篇里第一个合格句）。
 * 需要多条样本时继续往下走下一条结果，而不是把第一篇抽干。
 */
export function collectSentences(
  docs: SourceDocument[],
  term: string,
  minLen: number,
  maxLen: number,
  exclude: Set<string> = new Set(),
): SentenceHit[] {
  const seen = new Set<string>();
  const rows: SentenceHit[] = [];
  for (const doc of docs) {
    let hit: SentenceHit | null = null;
    for (const sent of splitSentences(doc.text)) {
      if (!goodSentence(sent, term, minLen, maxLen)) continue;
      const key = normalizeSentence(sent);
      if (seen.has(sent) || exclude.has(key)) continue;
      hit = { sent, doc };
      break;
    }
    if (!hit) continue;
    seen.add(hit.sent);
    rows.push(hit);
  }
  return rows;
}

function toNumber(value: string | number | null | undefined, fallback: number): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** flags 可覆盖 dict / pairsPerTerm / limitTerms / source / output。 */
export async function generate(cfg: ResolvedConfig, flags: GenerateFlags = {}): Promise<GenerateResult> {
  const dictPath = flags.dict || cfg.dict;
  if (!dictPath) throw new Error("请在配置中设置 dict，或使用 --dict");

  const pairsPerTerm = toNumber(flags.pairsPerTerm, cfg.pairsPerTerm);
  const rawLimit =
    flags.limitTerms != null && flags.limitTerms !== ""
      ? Number(flags.limitTerms)
      : cfg.limitTerms;
  const limitTerms = rawLimit != null && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : null;
  const minLen = cfg.sentence.minLen;
  const maxLen = cfg.sentence.maxLen;
  const instruction = flags.instruction?.trim() || cfg.instruction;
  const cleanRaw = Number(flags.cleanRatio ?? cfg.cleanRatio ?? 0);
  const cleanRatio = Math.min(1, Math.max(0, cleanRaw > 1 ? cleanRaw / 100 : cleanRaw));
  const maxPages = Math.max(1, toNumber(flags.maxPages, cfg.maxPages || 1));
  const formats = parseFormats(flags.format, cfg.formats);
  const writeSharegpt = wantsShareGpt(formats);
  const outFile = flags.output || cfg.paths.sft;
  const sharegptFile = cfg.paths.sftSharegpt;

  const cfgForSources =
    flags.sources?.length
      ? {
          ...cfg,
          sources: cfg.sources
            .filter((item) => flags.sources!.includes(item.name))
            .map((item) => ({ ...item, enabled: true })),
        }
      : cfg;
  const selected = selectSources(cfgForSources, flags.source).map((item) =>
    item.type === "http" ? { ...item, options: { ...item.options, maxPages } } : item,
  );
  if (!selected.length) {
    throw new Error('没有启用的检索源。请在配置的 sources 中设置 type: "http" 或 "local_jsonl"。');
  }

  const pairs = loadDictionary(dictPath);
  const grouped = groupByCorrect(pairs);
  let terms = [...grouped.keys()];
  if (limitTerms != null && Number.isFinite(limitTerms)) {
    terms = terms.slice(0, Number(limitTerms));
  }

  const limiter = new RequestRateLimiter(cfg.rate.requestsPerMinute, cfg.rate.jitterSec);
  const sources = selected.map((item) =>
    buildSource(item, { root: cfg.root, cacheDir: cfg.cacheDir, globalLimiter: limiter }),
  );

  const remoteCount = sources.filter((s) => s.remote).length;
  const estMin =
    remoteCount > 0 ? (terms.length / cfg.rate.requestsPerMinute).toFixed(1) : "0（无远程源）";

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const done = loadDoneKeys(outFile);
  const out = fs.createWriteStream(outFile, { flags: "a", encoding: "utf8" });

  console.log(`[generate] config=${cfg.configFile}`);
  console.log(
    `[generate] dict=${pairs.length} unique_correct=${grouped.size} terms=${terms.length} pairs_per_term=${pairsPerTerm} clean_ratio=${cleanRatio} max_pages=${maxPages}`,
  );
  console.log(`[generate] sources=${sources.map((s) => s.name).join(",")}`);
  console.log(
    `[generate] rate=${cfg.rate.requestsPerMinute}/min jitter=${cfg.rate.jitterSec}s 全量未命中缓存约 ${estMin} 分钟`,
  );
  console.log(`[generate] outDir=${cfg.outDir}`);
  console.log(`[generate] formats=${formats.join(",")} alpaca=${outFile}`);
  if (writeSharegpt) console.log(`[generate] sharegpt=${sharegptFile}`);

  let written = 0;
  const keepPool: SftExample[] = [];
  let termIndex = 0;
  for (const correct of terms) {
    termIndex += 1;
    let sentences: SentenceHit[] = [];
    for (const src of sources) {
      try {
        const docs = await src.search(correct);
        sentences = collectSentences(docs, correct, minLen, maxLen);
        console.log(
          `[search] ${termIndex}/${terms.length} source=${src.name} term=${correct} docs=${docs.length} sents=${sentences.length}`,
        );
        if (sentences.length) break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[fail] source=${src.name} term=${correct} ${message}`);
      }
    }

    const relatedPairs = grouped.get(correct) ?? [];
    for (const pair of relatedPairs) {
      let picked = 0;
      // sentences 已按检索列表从上到下、一条结果一句排好
      for (const { sent, doc } of sentences) {
        if (picked >= pairsPerTerm) break;
        if (sent.includes(pair.wrong)) continue;
        const input = sent.split(correct).join(pair.wrong);
        if (input === sent) continue;
        const key = `${pair.wrong}\t${pair.correct}\t${sent}`;
        if (done.has(key)) continue;
        const row: SftExample = {
          instruction,
          input,
          output: sent,
          error_type: pair.error_type,
          wrong: pair.wrong,
          correct: pair.correct,
          source: doc.source,
          url: doc.url,
          article_id: doc.doc_id,
        };
        out.write(`${JSON.stringify(row)}\n`);
        done.add(key);
        picked += 1;
        written += 1;
        if (keepPool.length < 4000) {
          keepPool.push({
            ...row,
            input: sent,
            error_type: "keep",
          });
        }
      }
    }
  }

  const keepN = cleanSampleCount(written, cleanRatio);
  for (let i = 0; i < keepN && keepPool.length; i += 1) {
    const src = keepPool[i % keepPool.length]!;
    const row: SftExample = { ...src, input: src.output };
    const key = `keep\t\t${row.output}`;
    if (done.has(key)) continue;
    out.write(`${JSON.stringify(row)}\n`);
    done.add(key);
    written += 1;
  }
  if (keepN) console.log(`[generate] clean_keep=${keepN}`);

  await new Promise<void>((resolve) => out.end(resolve));

  if (writeSharegpt) {
    const alpacaRows = readJsonl<SftExample>(outFile, "empty");
    writeJsonl(sharegptFile, alpacaRows.map(toShareGpt));
    console.log(`[done] wrote=${written} alpaca=${outFile} sharegpt=${sharegptFile}`);
    return { written, output: outFile, sharegpt: sharegptFile };
  }

  console.log(`[done] wrote=${written} file=${outFile}`);
  return { written, output: outFile };
}

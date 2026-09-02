/**
 * 独立生成验证集：同一套词对再检索，句子不得出现在训练集规范句中。
 * 与训练集相同：每个词多写几条错句（input 错 / output 对），并按比例混入正确句。
 */
import { isJobCancelled, throwIfAborted } from "./abort.js";
import fs from "node:fs";
import path from "node:path";
import { groupByCorrect, loadDictionary } from "./dictionary.js";
import { collectSentences } from "./generate.js";
import { cleanSampleCount } from "./generateMix.js";
import { readJsonl, writeJsonl } from "./jsonl.js";
import { RequestRateLimiter } from "./rateLimit.js";
import { leaksIntoTrain, normalizeSentence } from "./sentenceNorm.js";
import { buildSource, selectSources } from "./sources/registry.js";
import type { GenerateFlags, ResolvedConfig, SftExample } from "./types.js";

function toNumber(value: string | number | undefined, fallback: number): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trainOutputs(trainFile: string): string[] {
  if (!fs.existsSync(trainFile)) return [];
  return readJsonl<SftExample>(trainFile, "empty")
    .map((row) => row.output)
    .filter(Boolean);
}

export async function generateEval(
  cfg: ResolvedConfig,
  flags: GenerateFlags = {},
): Promise<{ written: number; output: string; leaked: number; errors: number; keep: number }> {
  const dictPath = flags.dict || cfg.dict;
  if (!dictPath) throw new Error("请在配置中设置 dict，或使用 --dict");
  const trainFile = cfg.paths.sft;
  if (!fs.existsSync(trainFile)) {
    throw new Error(`没有训练集 ${trainFile}，请先 generate`);
  }

  const pairsPerTerm = toNumber(flags.pairsPerTerm, cfg.pairsPerTerm);
  const rawLimit =
    flags.limitTerms != null && flags.limitTerms !== ""
      ? Number(flags.limitTerms)
      : cfg.limitTerms;
  const limitTerms = rawLimit != null && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : null;
  const cleanRaw = Number(flags.cleanRatio ?? cfg.cleanRatio ?? 0);
  const cleanRatio = Math.min(1, Math.max(0, cleanRaw > 1 ? cleanRaw / 100 : cleanRaw));
  const maxPages = Math.max(1, toNumber(flags.maxPages, cfg.maxPages || 1));

  const exclude = new Set(trainOutputs(trainFile).map(normalizeSentence));
  const pairs = loadDictionary(dictPath);
  const grouped = groupByCorrect(pairs);
  let terms = [...grouped.keys()];
  if (limitTerms != null) terms = terms.slice(0, Number(limitTerms));

  const limiter = new RequestRateLimiter(cfg.rate.requestsPerMinute, cfg.rate.jitterSec);
  const cfgForSources = flags.sources?.length
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
    throw new Error("没有启用的检索源。请在数据页至少选一个来源。");
  }
  const sources = selected.map((item) =>
    buildSource(item, {
      root: cfg.root,
      cacheDir: cfg.cacheDir,
      globalLimiter: limiter,
      signal: flags.signal,
    }),
  );

  const outFile = cfg.paths.eval;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const rows: SftExample[] = [];
  const evalSents: string[] = [];
  const keepPool: SftExample[] = [];

  console.log(
    `[generate-eval] unique_correct=${grouped.size} terms=${terms.length} pairs_per_term=${pairsPerTerm} clean_ratio=${cleanRatio} max_pages=${maxPages}`,
  );

  for (const correct of terms) {
    throwIfAborted(flags.signal);
    let sentences: ReturnType<typeof collectSentences> = [];
    for (const src of sources) {
      throwIfAborted(flags.signal);
      try {
        const docs = await src.search(correct);
        sentences = collectSentences(docs, correct, cfg.sentence.minLen, cfg.sentence.maxLen, exclude);
        if (sentences.length) break;
      } catch (err) {
        if (isJobCancelled(err)) throw err;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[eval-fail] source=${src.name} term=${correct} ${message}`);
      }
    }
    const related = grouped.get(correct) ?? [];
    for (const pair of related) {
      let picked = 0;
      for (const hit of sentences) {
        if (picked >= pairsPerTerm) break;
        if (hit.sent.includes(pair.wrong)) continue;
        const input = hit.sent.split(correct).join(pair.wrong);
        if (input === hit.sent) continue;
        exclude.add(normalizeSentence(hit.sent));
        evalSents.push(hit.sent);
        const row: SftExample = {
          instruction: cfg.instruction,
          input,
          output: hit.sent,
          error_type: pair.error_type,
          wrong: pair.wrong,
          correct: pair.correct,
          source: hit.doc.source,
          url: hit.doc.url,
          article_id: hit.doc.doc_id,
          split: "error",
        };
        rows.push(row);
        if (keepPool.length < 4000) {
          keepPool.push({ ...row, input: hit.sent, error_type: "keep", split: "keep", wrong: "", correct: "" });
        }
        picked += 1;
      }
    }
  }

  const leaked = leaksIntoTrain(evalSents, trainOutputs(trainFile));
  if (leaked.length) {
    throw new Error(`验证集与训练句泄漏 ${leaked.length} 条，已中止写出`);
  }

  const errorCount = rows.length;
  const keepN = cleanSampleCount(errorCount, cleanRatio);
  const usedKeep = new Set<string>();
  for (let i = 0; i < keepN && keepPool.length; i += 1) {
    const src = keepPool[i % keepPool.length]!;
    const key = normalizeSentence(src.output);
    if (usedKeep.has(key)) continue;
    usedKeep.add(key);
    rows.push({ ...src, input: src.output });
  }

  writeJsonl(outFile, rows);
  const readme = path.join(path.dirname(outFile), "README.md");
  fs.writeFileSync(
    readme,
    `# 验证集\n\n条数: ${rows.length}（错句 ${errorCount}，正确句 ${rows.length - errorCount}）\n` +
      `input 是待改的句子（含不规范表述），output 是规范句。正确句的 input 与 output 相同。\n` +
      `与训练集规范句交集: 0。本文件独立检索生成，不是从训练集剥离。\n`,
    "utf8",
  );
  console.log(`[generate-eval] wrote=${rows.length} errors=${errorCount} keep=${rows.length - errorCount} file=${outFile}`);
  return { written: rows.length, output: outFile, leaked: 0, errors: errorCount, keep: rows.length - errorCount };
}

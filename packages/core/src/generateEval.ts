/**
 * 独立生成验证集：同一套词对再检索，句子不得出现在训练集规范句中。
 */
import fs from "node:fs";
import path from "node:path";
import { groupByCorrect, loadDictionary } from "./dictionary.js";
import { collectSentences } from "./generate.js";
import { readJsonl, writeJsonl } from "./jsonl.js";
import { RequestRateLimiter } from "./rateLimit.js";
import { leaksIntoTrain, normalizeSentence } from "./sentenceNorm.js";
import { buildSource, selectSources } from "./sources/registry.js";
import type { GenerateFlags, ResolvedConfig, SftExample } from "./types.js";

function trainOutputs(trainFile: string): string[] {
  if (!fs.existsSync(trainFile)) return [];
  return readJsonl<SftExample>(trainFile, "empty")
    .map((row) => row.output)
    .filter(Boolean);
}

export async function generateEval(
  cfg: ResolvedConfig,
  flags: GenerateFlags = {},
): Promise<{ written: number; output: string; leaked: number }> {
  const dictPath = flags.dict || cfg.dict;
  if (!dictPath) throw new Error("请在配置中设置 dict，或使用 --dict");
  const trainFile = cfg.paths.sft;
  if (!fs.existsSync(trainFile)) {
    throw new Error(`没有训练集 ${trainFile}，请先 generate`);
  }

  const exclude = new Set(trainOutputs(trainFile).map(normalizeSentence));
  const pairs = loadDictionary(dictPath);
  const grouped = groupByCorrect(pairs);
  const limiter = new RequestRateLimiter(cfg.rate.requestsPerMinute, cfg.rate.jitterSec);
  const selected = selectSources(cfg, flags.source);
  const sources = selected.map((item) =>
    buildSource(item, { root: cfg.root, cacheDir: cfg.cacheDir, globalLimiter: limiter }),
  );

  const outFile = cfg.paths.eval;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const rows: SftExample[] = [];
  const evalSents: string[] = [];

  for (const [correct, related] of grouped) {
    let sentences: ReturnType<typeof collectSentences> = [];
    for (const src of sources) {
      try {
        const docs = await src.search(correct);
        sentences = collectSentences(
          docs,
          correct,
          cfg.sentence.minLen,
          cfg.sentence.maxLen,
          exclude,
        );
        if (sentences.length) break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[eval-fail] source=${src.name} term=${correct} ${message}`);
      }
    }
    const pair = related[0];
    if (!pair) continue;
    const hit = sentences[0];
    if (!hit) continue;
    const input = hit.sent.split(correct).join(pair.wrong);
    if (input === hit.sent) continue;
    exclude.add(normalizeSentence(hit.sent));
    evalSents.push(hit.sent);
    rows.push({
      instruction: cfg.instruction,
      input,
      output: hit.sent,
      error_type: pair.error_type,
      wrong: pair.wrong,
      correct: pair.correct,
      source: hit.doc.source,
      url: hit.doc.url,
      article_id: hit.doc.doc_id,
    });
  }

  const leaked = leaksIntoTrain(
    evalSents,
    trainOutputs(trainFile),
  );
  if (leaked.length) {
    throw new Error(`验证集与训练句泄漏 ${leaked.length} 条，已中止写出`);
  }

  writeJsonl(outFile, rows);
  const readme = path.join(path.dirname(outFile), "README.md");
  fs.writeFileSync(
    readme,
    `# 验证集\n\n条数: ${rows.length}\n与训练集规范句交集: 0\n本文件由 generate-eval 独立检索生成，不是从训练集剥离。\n`,
    "utf8",
  );
  console.log(`[generate-eval] wrote=${rows.length} file=${outFile}`);
  return { written: rows.length, output: outFile, leaked: 0 };
}

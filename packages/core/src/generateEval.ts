/**
 * 独立生成验证集：同一套词对再检索，句子不得出现在训练集规范句中。
 * 写入当前数据实验的 eval/，支持中断后续写。
 */
import { isJobCancelled, throwIfAborted } from "./abort.js";
import fs from "node:fs";
import path from "node:path";
import { groupByCorrect, loadDictionary } from "./dictionary.js";
import { collectSentences } from "./generate.js";
import { cleanSampleCount } from "./generateMix.js";
import { readJsonl } from "./jsonl.js";
import { RequestRateLimiter } from "./rateLimit.js";
import { normalizeSentence } from "./sentenceNorm.js";
import { appendRunLog, patchRun, writeDataProgress } from "./runs/store.js";
import { resolveEvalSession } from "./runs/dataSession.js";
import { buildSource, selectSources } from "./sources/registry.js";
import type { GenerateFlags, ResolvedConfig, SftExample } from "./types.js";

function trainOutputs(trainFile: string): string[] {
  if (!fs.existsSync(trainFile)) return [];
  return readJsonl<SftExample>(trainFile, "empty")
    .map((row) => row.output)
    .filter(Boolean);
}

function loadEvalKeys(outFile: string): Set<string> {
  const keys = new Set<string>();
  if (!fs.existsSync(outFile)) return keys;
  for (const row of readJsonl<SftExample>(outFile, "empty")) {
    keys.add(`${row.wrong}\t${row.correct}\t${row.output}`);
    if (row.output) keys.add(`sent:${normalizeSentence(row.output)}`);
  }
  return keys;
}

export async function generateEval(
  cfg: ResolvedConfig,
  flags: GenerateFlags = {},
): Promise<{ written: number; output: string; leaked: number; errors: number; keep: number }> {
  const dictPath = flags.dict || cfg.dict;
  if (!dictPath) throw new Error("请在配置中设置 dict，或使用 --dict");

  const session = resolveEvalSession(cfg, flags);
  const { paths, params } = session;
  let progress = session.progress;
  const trainFile = paths.train;
  const outFile = paths.eval;

  const pairs = loadDictionary(dictPath);
  const grouped = groupByCorrect(pairs);
  let terms = [...grouped.keys()];
  if (params.limitTerms != null) terms = terms.slice(0, params.limitTerms);

  const limiter = new RequestRateLimiter(cfg.rate.requestsPerMinute, cfg.rate.jitterSec);
  const cfgForSources = params.sources.length
    ? {
        ...cfg,
        sources: cfg.sources
          .filter((item) => params.sources.includes(item.name))
          .map((item) => ({ ...item, enabled: true })),
      }
    : cfg;
  const selected = selectSources(cfgForSources, flags.source).map((item) =>
    item.type === "http" ? { ...item, options: { ...item.options, maxPages: params.maxPages } } : item,
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

  const log = (line: string): void => {
    console.log(line);
    appendRunLog(paths.logs, line);
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const exclude = new Set(trainOutputs(trainFile).map(normalizeSentence));
  const done = loadEvalKeys(outFile);
  for (const key of done) {
    if (key.startsWith("sent:")) exclude.add(key.slice(5));
  }
  const out = fs.createWriteStream(outFile, { flags: "a", encoding: "utf8" });
  const keepPool: SftExample[] = [];
  let writtenError = progress.evalWritten;
  let writtenKeep = progress.evalKeep;
  let skippedLeak = progress.skippedLeak;
  const startIndex = Math.max(0, progress.evalTermIndex);

  progress.phase = "generating_eval";
  progress.termTotal = terms.length;
  patchRun(cfg.outDir, "data", session.meta.id, {
    status: "running",
    phase: "generating_eval",
    pid: process.pid,
    error: null,
  });
  log(`[generate-eval] run=${session.meta.id} terms=${terms.length} pairs_per_term=${params.pairsPerTerm}`);

  const writeKeep = (): void => {
    const target = cleanSampleCount(writtenError, params.cleanRatio);
    while (writtenKeep < target && keepPool.length) {
      const src = keepPool[writtenKeep % keepPool.length]!;
      const sentKey = normalizeSentence(src.output);
      if (exclude.has(sentKey) && src.error_type === "keep") {
        /* keep 来自已写入的 eval 句，允许 */
      }
      const key = `keep\t\t${src.output}`;
      if (done.has(key)) {
        writtenKeep += 1;
        continue;
      }
      out.write(`${JSON.stringify({ ...src, input: src.output })}\n`);
      done.add(key);
      writtenKeep += 1;
    }
  };

  try {
    for (let termIndex = startIndex; termIndex < terms.length; termIndex += 1) {
      throwIfAborted(flags.signal);
      const correct = terms[termIndex]!;
      progress.evalTermIndex = termIndex;
      progress.currentCorrect = correct;
      let sentences: ReturnType<typeof collectSentences> = [];
      for (const src of sources) {
        throwIfAborted(flags.signal);
        try {
          const docs = await src.search(correct);
          sentences = collectSentences(docs, correct, params.minLen, params.maxLen, exclude);
          if (sentences.length) break;
        } catch (err) {
          if (isJobCancelled(err)) throw err;
          const message = err instanceof Error ? err.message : String(err);
          log(`[eval-fail] source=${src.name} term=${correct} ${message}`);
        }
      }
      const related = grouped.get(correct) ?? [];
      for (const pair of related) {
        let picked = 0;
        for (const hit of sentences) {
          if (picked >= params.pairsPerTerm) break;
          if (hit.sent.includes(pair.wrong)) continue;
          const input = hit.sent.split(correct).join(pair.wrong);
          if (input === hit.sent) continue;
          const norm = normalizeSentence(hit.sent);
          if (exclude.has(norm)) {
            skippedLeak += 1;
            continue;
          }
          const key = `${pair.wrong}\t${pair.correct}\t${hit.sent}`;
          if (done.has(key)) continue;
          exclude.add(norm);
          const row: SftExample = {
            instruction: params.instruction,
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
          out.write(`${JSON.stringify(row)}\n`);
          done.add(key);
          done.add(`sent:${norm}`);
          writtenError += 1;
          if (keepPool.length < 4000) {
            keepPool.push({ ...row, input: hit.sent, error_type: "keep", split: "keep", wrong: "", correct: "" });
          }
          picked += 1;
        }
      }
      writeKeep();
      progress.evalTermIndex = termIndex + 1;
      progress.evalWritten = writtenError;
      progress.evalKeep = writtenKeep;
      progress.skippedLeak = skippedLeak;
      writeDataProgress(cfg.outDir, session.meta.id, progress);
    }
    writeKeep();
    progress.phase = "completed";
    progress.evalWritten = writtenError;
    progress.evalKeep = writtenKeep;
    progress.skippedLeak = skippedLeak;
    writeDataProgress(cfg.outDir, session.meta.id, progress);
  } catch (err) {
    progress.evalWritten = writtenError;
    progress.evalKeep = writtenKeep;
    progress.skippedLeak = skippedLeak;
    writeDataProgress(cfg.outDir, session.meta.id, progress);
    await new Promise<void>((resolve) => out.end(resolve));
    if (isJobCancelled(err)) {
      patchRun(cfg.outDir, "data", session.meta.id, {
        status: "interrupted",
        phase: "generating_eval",
        pid: null,
        exitCode: 130,
        skippedLeak,
      });
      throw err;
    }
    patchRun(cfg.outDir, "data", session.meta.id, {
      status: "failed",
      phase: "generating_eval",
      pid: null,
      error: err instanceof Error ? err.message : String(err),
      exitCode: 1,
      skippedLeak,
    });
    throw err;
  }

  await new Promise<void>((resolve) => out.end(resolve));
  throwIfAborted(flags.signal);

  fs.writeFileSync(
    path.join(paths.evalDir, "README.md"),
    `# 验证集\n\n条数: ${writtenError + writtenKeep}（错句 ${writtenError}，正确句 ${writtenKeep}）\n` +
      `与训练集规范句泄漏跳过: ${skippedLeak}。本文件独立检索生成。\n`,
    "utf8",
  );
  patchRun(cfg.outDir, "data", session.meta.id, {
    status: "completed",
    phase: "completed",
    pid: null,
    exitCode: 0,
    error: null,
    skippedLeak,
  });
  log(`[generate-eval] wrote=${writtenError + writtenKeep} errors=${writtenError} keep=${writtenKeep} leaked_skip=${skippedLeak} file=${outFile}`);
  return {
    written: writtenError + writtenKeep,
    output: outFile,
    leaked: skippedLeak,
    errors: writtenError,
    keep: writtenKeep,
  };
}

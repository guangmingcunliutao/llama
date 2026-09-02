/**
 * 生成 SFT 句对：用正确词检索权威正文，切句后把正确词换成错误词。
 * 写入当前数据实验目录，支持中断后续跑、全新、以及在上一份上追加。
 */
import { isJobCancelled, throwIfAborted } from "./abort.js";
import fs from "node:fs";
import path from "node:path";
import { groupByCorrect, loadDictionary } from "./dictionary.js";
import { parseFormats, toShareGpt, wantsShareGpt } from "./format.js";
import { cleanSampleCount } from "./generateMix.js";
import { readJsonl, writeJsonl } from "./jsonl.js";
import { RequestRateLimiter } from "./rateLimit.js";
import { appendRunLog, patchRun, writeDataProgress } from "./runs/store.js";
import { resolveDataSession } from "./runs/dataSession.js";
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

function emitKeep(
  out: fs.WriteStream,
  done: Set<string>,
  keepPool: SftExample[],
  writtenError: number,
  writtenKeep: number,
  cleanRatio: number,
): number {
  const target = cleanSampleCount(writtenError, cleanRatio);
  let keep = writtenKeep;
  while (keep < target && keepPool.length) {
    const src = keepPool[keep % keepPool.length]!;
    const row: SftExample = { ...src, input: src.output, error_type: "keep" };
    const key = `keep\t\t${row.output}`;
    if (done.has(key)) {
      keep += 1;
      continue;
    }
    out.write(`${JSON.stringify(row)}\n`);
    done.add(key);
    keep += 1;
  }
  return keep;
}

export async function generate(cfg: ResolvedConfig, flags: GenerateFlags = {}): Promise<GenerateResult> {
  const dictPath = flags.dict || cfg.dict;
  if (!dictPath) throw new Error("请在配置中设置 dict，或使用 --dict");

  const session = resolveDataSession(cfg, flags);
  const { paths, params } = session;
  let progress = session.progress;
  const outFile = flags.output || paths.train;
  const formats = parseFormats(params.formats.join(","), cfg.formats);
  const writeSharegpt = wantsShareGpt(formats);

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
    throw new Error('没有启用的检索源。请在配置的 sources 中设置 type: "http" 或 "local_jsonl"。');
  }

  const pairs = loadDictionary(dictPath);
  const grouped = groupByCorrect(pairs);
  let terms = [...grouped.keys()];
  if (params.limitTerms != null) terms = terms.slice(0, params.limitTerms);
  const hold = Math.floor(terms.length * (params.unseenPairRatio ?? 0));
  const trainTerms = hold > 0 ? terms.slice(0, terms.length - hold) : terms;

  const limiter = new RequestRateLimiter(cfg.rate.requestsPerMinute, cfg.rate.jitterSec);
  const sources = selected.map((item) =>
    buildSource(item, { root: cfg.root, cacheDir: cfg.cacheDir, globalLimiter: limiter, signal: flags.signal }),
  );

  const log = (line: string): void => {
    console.log(line);
    appendRunLog(paths.logs, line);
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const done = loadDoneKeys(outFile);
  const out = fs.createWriteStream(outFile, { flags: "a", encoding: "utf8" });
  const signal = flags.signal;

  log(`[generate] run=${session.meta.id} mode=${session.meta.mode}`);
  log(
    `[generate] dict=${pairs.length} unique_correct=${grouped.size} train_terms=${trainTerms.length} holdout_unseen=${hold} pairs_per_term=${params.pairsPerTerm} clean_ratio=${params.cleanRatio} max_pages=${params.maxPages}`,
  );
  log(`[generate] sources=${sources.map((s) => s.name).join(",")}`);
  log(`[generate] alpaca=${outFile}`);

  if (progress.phase === "train_done" || progress.phase === "completed" || progress.phase === "generating_eval") {
    throw new Error("训练集已完成。要补数据请用「在上次基础上追加」；验证集请点「生成验证集」。");
  }
  progress.termTotal = trainTerms.length;
  progress.phase = "generating_train";
  let writtenError = progress.writtenError;
  let writtenKeep = progress.writtenKeep;
  const keepPool: SftExample[] = [];
  const startIndex = Math.max(0, progress.termIndex);

  patchRun(cfg.outDir, "data", session.meta.id, {
    status: "running",
    phase: "generating_train",
    pid: process.pid,
    error: null,
  });

  try {
    for (let termIndex = startIndex; termIndex < trainTerms.length; termIndex += 1) {
      throwIfAborted(signal);
      const correct = trainTerms[termIndex]!;
      progress.termIndex = termIndex;
      progress.currentCorrect = correct;
      let sentences: SentenceHit[] = [];
      for (const src of sources) {
        throwIfAborted(signal);
        try {
          const docs = await src.search(correct);
          sentences = collectSentences(docs, correct, params.minLen, params.maxLen);
          log(
            `[search] ${termIndex + 1}/${trainTerms.length} source=${src.name} term=${correct} docs=${docs.length} sents=${sentences.length}`,
          );
          if (sentences.length) break;
        } catch (err) {
          if (isJobCancelled(err)) throw err;
          const message = err instanceof Error ? err.message : String(err);
          log(`[fail] source=${src.name} term=${correct} ${message}`);
        }
      }

      const relatedPairs = grouped.get(correct) ?? [];
      for (const pair of relatedPairs) {
        let picked = 0;
        for (const { sent, doc } of sentences) {
          if (picked >= params.pairsPerTerm) break;
          if (sent.includes(pair.wrong)) continue;
          const input = sent.split(correct).join(pair.wrong);
          if (input === sent) continue;
          const key = `${pair.wrong}\t${pair.correct}\t${sent}`;
          if (done.has(key)) continue;
          const row: SftExample = {
            instruction: params.instruction,
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
          writtenError += 1;
          if (keepPool.length < 4000) {
            keepPool.push({ ...row, input: sent, error_type: "keep" });
          }
        }
      }
      writtenKeep = emitKeep(out, done, keepPool, writtenError, writtenKeep, params.cleanRatio);
      progress.termIndex = termIndex + 1;
      progress.writtenError = writtenError;
      progress.writtenKeep = writtenKeep;
      writeDataProgress(cfg.outDir, session.meta.id, progress);
    }

    writtenKeep = emitKeep(out, done, keepPool, writtenError, writtenKeep, params.cleanRatio);
    progress.writtenKeep = writtenKeep;
    progress.phase = "train_done";
    writeDataProgress(cfg.outDir, session.meta.id, progress);
  } catch (err) {
    progress.writtenError = writtenError;
    progress.writtenKeep = writtenKeep;
    writeDataProgress(cfg.outDir, session.meta.id, progress);
    await new Promise<void>((resolve) => out.end(resolve));
    if (isJobCancelled(err)) {
      patchRun(cfg.outDir, "data", session.meta.id, {
        status: "interrupted",
        phase: "generating_train",
        pid: null,
        exitCode: 130,
      });
      throw err;
    }
    patchRun(cfg.outDir, "data", session.meta.id, {
      status: "failed",
      phase: "generating_train",
      pid: null,
      error: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    });
    throw err;
  }

  await new Promise<void>((resolve) => out.end(resolve));
  throwIfAborted(signal);

  patchRun(cfg.outDir, "data", session.meta.id, {
    status: "completed",
    phase: "train_done",
    pid: null,
    exitCode: 0,
    error: null,
  });

  const written = writtenError + writtenKeep;
  if (writeSharegpt) {
    const alpacaRows = readJsonl<SftExample>(outFile, "empty");
    writeJsonl(paths.trainSharegpt, alpacaRows.map(toShareGpt));
    log(`[done] wrote=${written} alpaca=${outFile} sharegpt=${paths.trainSharegpt}`);
    return { written, output: outFile, sharegpt: paths.trainSharegpt };
  }

  log(`[done] wrote=${written} file=${outFile}`);
  return { written, output: outFile };
}

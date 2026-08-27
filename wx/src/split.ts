/**
 * 建设训练集与评估集，避免「同句既训又测」。
 *
 * eval_unseen_pair：整组错误词-正确词从未进训练，测词对泛化。
 * eval_seen_pair：词对在训练里出现过，但句子没有，测同词对不同上下文。
 * eval_keep：已是规范句，模型不应改动，测过度编辑。
 *
 * 词对按错误类型分层抽 unseen；同一正句若同时出现在训练和评估，从训练侧剔除。
 */
import fs from "node:fs";
import path from "node:path";
import { loadDictionary } from "./dictionary.js";
import { toShareGpt, wantsShareGpt } from "./format.js";
import { readJsonOrJsonl, writeJsonl } from "./jsonl.js";
import type {
  ResolvedConfig,
  SftExample,
  SplitFlags,
  SplitReport,
  SplitSliceCounts,
} from "./types.js";

export function pairKey(row: Pick<SftExample, "wrong" | "correct">): string {
  return `${row.wrong || ""}\t${row.correct || ""}`;
}

export function freqBucket(freq: number): string {
  if (freq >= 1000) return "high";
  if (freq >= 10) return "mid";
  return "low";
}

/** 可复现的洗牌（线性同余），保证同一 seed 划分一致。 */
export function shuffle<T>(arr: T[], seed = 42): T[] {
  let s = seed;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

function emptySlice(): SplitSliceCounts {
  return { train: 0, eval_seen_pair: 0, eval_unseen_pair: 0, eval_keep: 0 };
}

function bump(
  table: Record<string, SplitSliceCounts>,
  key: string,
  field: keyof SplitSliceCounts,
): void {
  const bucket = table[key] ?? (table[key] = emptySlice());
  bucket[field] += 1;
}

function loadFreqMap(dictPath: string | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!dictPath || !fs.existsSync(dictPath)) return map;
  for (const pair of loadDictionary(dictPath)) {
    const key = `${pair.wrong}\t${pair.correct}`;
    const prev = map.get(key) ?? 0;
    if (pair.freq > prev) map.set(key, pair.freq);
  }
  return map;
}

function withMeta(
  row: SftExample,
  split: string,
  id: string,
  freqMap: Map<string, number>,
): SftExample {
  const freq = row.freq ?? freqMap.get(pairKey(row)) ?? 0;
  return {
    ...row,
    split,
    id,
    freq,
    freq_bucket: row.freq_bucket || freqBucket(freq),
  };
}

function outputsOf(rows: SftExample[]): Set<string> {
  return new Set(rows.map((row) => row.output));
}

/**
 * 按错误类型分层抽取 unseen 词对，避免评估集被单一类型占满。
 */
export function pickUnseenKeys(
  byPair: Map<string, SftExample[]>,
  ratio: number,
  seed: number,
  maxUnseenPairs: number | null,
): Set<string> {
  const byType = new Map<string, string[]>();
  for (const [key, items] of byPair) {
    const type = items[0]?.error_type || "unknown";
    const list = byType.get(type);
    if (list) list.push(key);
    else byType.set(type, [key]);
  }

  const picked: string[] = [];
  let typeIndex = 0;
  for (const keys of byType.values()) {
    const shuffled = shuffle(keys, seed + typeIndex);
    typeIndex += 1;
    const raw = Math.round(shuffled.length * ratio);
    const n =
      ratio > 0 && shuffled.length >= 2 && raw === 0 ? 1 : Math.min(shuffled.length, Math.max(0, raw));
    picked.push(...shuffled.slice(0, n));
  }

  let unseen = shuffle(picked, seed + 99);
  if (unseen.length === 0 && byPair.size >= 2) {
    unseen = shuffle([...byPair.keys()], seed).slice(0, 1);
  }
  if (maxUnseenPairs != null && Number.isFinite(maxUnseenPairs) && maxUnseenPairs >= 0) {
    unseen = unseen.slice(0, maxUnseenPairs);
  }
  return new Set(unseen);
}

function assignIds(rows: SftExample[], prefix: string): SftExample[] {
  return rows.map((row, i) => ({
    ...row,
    id: `${prefix}-${String(i + 1).padStart(6, "0")}`,
    split: prefix,
  }));
}

/** 写出 splits/train.jsonl 与 eval/ 下评估文件，并写 reports/split.json。 */
export function splitDataset(cfg: ResolvedConfig, flags: SplitFlags = {}): SplitReport {
  const input = flags.input || cfg.paths.sft;
  const rows = readJsonOrJsonl<SftExample>(input);
  const unseenRatio = cfg.split.unseenPairRatio;
  const seenSentRatio = cfg.split.seenPairEvalRatio;
  const minPairSize = Math.max(2, cfg.split.minPairSizeForSeenEval);
  const seed = cfg.split.seed;
  const freqMap = loadFreqMap(cfg.dict);

  const byPair = new Map<string, SftExample[]>();
  for (const row of rows) {
    const key = pairKey(row);
    const list = byPair.get(key);
    if (list) list.push(row);
    else byPair.set(key, [row]);
  }

  const unseenKeys = pickUnseenKeys(byPair, unseenRatio, seed, cfg.split.maxUnseenPairs);

  let train: SftExample[] = [];
  let evalUnseen: SftExample[] = [];
  let evalSeen: SftExample[] = [];
  let seenEligible = 0;

  for (const [key, items] of byPair) {
    const shuffled = shuffle(items, seed);
    if (unseenKeys.has(key)) {
      evalUnseen.push(...shuffled);
      continue;
    }
    const canHoldOut = shuffled.length >= minPairSize;
    if (canHoldOut) seenEligible += 1;
    const nEval = canHoldOut
      ? Math.max(1, Math.min(shuffled.length - 1, Math.round(shuffled.length * seenSentRatio) || 1))
      : 0;
    shuffled.forEach((row, i) => {
      if (i < nEval) evalSeen.push(row);
      else train.push(row);
    });
  }

  const unseenOutputs = outputsOf(evalUnseen);
  const trainBeforeLeak = train.length;
  train = train.filter((row) => !unseenOutputs.has(row.output));
  const droppedTrainLeakage = trainBeforeLeak - train.length;

  const trainOutputs = outputsOf(train);
  const seenBeforeLeak = evalSeen.length;
  const leakedSeen: SftExample[] = [];
  evalSeen = evalSeen.filter((row) => {
    const leak = trainOutputs.has(row.output) || unseenOutputs.has(row.output);
    if (leak) leakedSeen.push(row);
    return !leak;
  });
  for (const row of leakedSeen) {
    if (!unseenOutputs.has(row.output)) train.push(row);
  }
  const droppedEvalSeenLeakage = seenBeforeLeak - evalSeen.length;

  const trainOutputsAfter = outputsOf(train);
  const unseenBeforeLeak = evalUnseen.length;
  evalUnseen = evalUnseen.filter((row) => !trainOutputsAfter.has(row.output));
  const droppedEvalUnseenLeakage = unseenBeforeLeak - evalUnseen.length;

  const keepPool = shuffle(
    train.filter((row) => row.output && !unseenOutputs.has(row.output)),
    seed + 7,
  );
  const seenKeep = new Set<string>();
  const keepTarget = Math.min(
    cfg.split.maxKeep,
    Math.max(keepPool.length ? 1 : 0, Math.round(train.length * cfg.split.keepRatio)),
  );
  const evalKeepRaw: SftExample[] = [];
  for (const row of keepPool) {
    if (evalKeepRaw.length >= keepTarget) break;
    if (seenKeep.has(row.output)) continue;
    seenKeep.add(row.output);
    evalKeepRaw.push({
      ...row,
      input: row.output,
      output: row.output,
    });
  }

  train = assignIds(train, "train").map((row, i) =>
    withMeta(row, "train", String(row.id ?? `train-${i}`), freqMap),
  );
  evalSeen = assignIds(evalSeen, "eval_seen_pair").map((row, i) =>
    withMeta(row, "eval_seen_pair", String(row.id ?? `eval_seen_pair-${i}`), freqMap),
  );
  evalUnseen = assignIds(evalUnseen, "eval_unseen_pair").map((row, i) =>
    withMeta(row, "eval_unseen_pair", String(row.id ?? `eval_unseen_pair-${i}`), freqMap),
  );
  const evalKeep = assignIds(evalKeepRaw, "eval_keep").map((row, i) =>
    withMeta(row, "eval_keep", String(row.id ?? `eval_keep-${i}`), freqMap),
  );

  const evalAll = [...evalSeen, ...evalUnseen];
  const trainOut = flags.trainOut || cfg.paths.trainSplit;
  const evalOut = flags.evalOut || cfg.paths.eval;
  writeJsonl(trainOut, train);
  writeJsonl(cfg.paths.evalSeen, evalSeen);
  writeJsonl(cfg.paths.evalUnseen, evalUnseen);
  writeJsonl(cfg.paths.evalKeep, evalKeep);
  writeJsonl(evalOut, evalAll);

  const byErrorType: Record<string, SplitSliceCounts> = {};
  const byFreq: Record<string, SplitSliceCounts> = {};
  const tally = (row: SftExample, field: keyof SplitSliceCounts) => {
    bump(byErrorType, row.error_type || "unknown", field);
    bump(byFreq, row.freq_bucket || "low", field);
  };
  for (const row of train) tally(row, "train");
  for (const row of evalSeen) tally(row, "eval_seen_pair");
  for (const row of evalUnseen) tally(row, "eval_unseen_pair");
  for (const row of evalKeep) tally(row, "eval_keep");

  const report: SplitReport = {
    input,
    outDir: cfg.outDir,
    total: rows.length,
    unique_pairs: byPair.size,
    train: train.length,
    eval: evalAll.length,
    eval_seen_pair: evalSeen.length,
    eval_unseen_pair: evalUnseen.length,
    eval_keep: evalKeep.length,
    unseen_pairs: unseenKeys.size,
    seen_pairs_eligible: seenEligible,
    dropped_train_leakage: droppedTrainLeakage,
    dropped_eval_seen_leakage: droppedEvalSeenLeakage,
    dropped_eval_unseen_leakage: droppedEvalUnseenLeakage,
    min_pair_size_for_seen_eval: minPairSize,
    by_error_type: byErrorType,
    by_freq_bucket: byFreq,
    files: {
      train: trainOut,
      eval: evalOut,
      eval_seen_pair: cfg.paths.evalSeen,
      eval_unseen_pair: cfg.paths.evalUnseen,
      eval_keep: cfg.paths.evalKeep,
    },
  };
  if (wantsShareGpt(cfg.formats)) {
    writeJsonl(cfg.paths.trainSplitSharegpt, train.map(toShareGpt));
    report.train_sharegpt = cfg.paths.trainSplitSharegpt;
  }
  fs.mkdirSync(path.dirname(cfg.paths.splitReport), { recursive: true });
  fs.writeFileSync(cfg.paths.splitReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("[split]", JSON.stringify(report, null, 2));
  console.log(`[split] train=${trainOut}`);
  console.log(`[split] eval=${evalOut}`);
  console.log(`[split] eval_seen=${cfg.paths.evalSeen}`);
  console.log(`[split] eval_unseen=${cfg.paths.evalUnseen}`);
  console.log(`[split] eval_keep=${cfg.paths.evalKeep}`);
  return report;
}

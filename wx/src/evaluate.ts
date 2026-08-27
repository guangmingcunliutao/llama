/**
 * 评估固定表述纠错：不仅看全文是否一致，还看是不是「只改了那个词」。
 *
 * exact_match       预测与 gold 一致（忽略空白）
 * term_fix_rate     正确词出现，且错误词不再作为独立片段残留
 * only_term_change  预测恰好等于 input 里 wrong→correct
 * over_edit_rate    既不是 exact match，又超出了单纯换词
 * copy_input_rate   原样复述了错句（纠错失败）
 * empty_rate        空输出
 *
 * 正确词若包含错误词（如 十九大 → 党的十九大），先去掉正确词跨度再检查错词残留。
 */
import fs from "node:fs";
import path from "node:path";
import { readJsonl, writeJsonl } from "./jsonl.js";
import type {
  EvaluateFlags,
  MetricsGroup,
  MetricsReport,
  PredictionRow,
  ResolvedConfig,
  SftExample,
} from "./types.js";

function normalize(text: string | undefined): string {
  return String(text || "")
    .replace(/\s+/g, "")
    .trim();
}

export interface ScoreBits {
  exact: boolean;
  term_fixed: boolean;
  only_term_change: boolean;
  over_edit: boolean;
  copy_input: boolean;
  empty: boolean;
}

export interface ScoredRow extends ScoreBits {
  id: string | number;
  split: string;
  error_type: string;
  freq_bucket: string;
  wrong: string;
  correct: string;
  input: string;
  gold: string;
  pred: string;
}

/** 去掉正确词跨度后，错词是否还在。避免「党的十九大」被当成仍含「十九大」。 */
export function wrongStillPresent(pred: string, wrong: string, correct: string): boolean {
  if (!wrong) return false;
  const remainder = correct ? pred.split(correct).join("") : pred;
  return remainder.includes(wrong);
}

export function scoreOne(gold: SftExample, predText: string): ScoreBits {
  const pred = normalize(predText);
  const goldOut = normalize(gold.output);
  const input = normalize(gold.input);
  const wrong = gold.wrong || "";
  const correct = gold.correct || "";
  const exact = pred === goldOut;
  const empty = pred.length === 0;
  const copyInput = pred === input && input !== goldOut;
  const expected = wrong && correct ? normalize((gold.input || "").split(wrong).join(correct)) : goldOut;
  const onlyTermChange = pred === expected;
  const termFixed =
    Boolean(correct) && pred.includes(normalize(correct)) && !wrongStillPresent(pred, normalize(wrong), normalize(correct));
  const overEdit = exact ? false : pred !== expected;
  return {
    exact,
    term_fixed: termFixed,
    only_term_change: onlyTermChange,
    over_edit: overEdit,
    copy_input: copyInput,
    empty,
  };
}

function emptyGroup(): MetricsGroup {
  return {
    n: 0,
    exact_match: 0,
    term_fix_rate: 0,
    only_term_change: 0,
    over_edit_rate: 0,
    copy_input_rate: 0,
    empty_rate: 0,
  };
}

interface Counts {
  n: number;
  exact: number;
  term_fixed: number;
  only_term_change: number;
  over_edit: number;
  copy_input: number;
  empty: number;
}

function emptyCounts(): Counts {
  return { n: 0, exact: 0, term_fixed: 0, only_term_change: 0, over_edit: 0, copy_input: 0, empty: 0 };
}

function addScore(bucket: Counts, s: ScoreBits): void {
  bucket.n += 1;
  bucket.exact += s.exact ? 1 : 0;
  bucket.term_fixed += s.term_fixed ? 1 : 0;
  bucket.only_term_change += s.only_term_change ? 1 : 0;
  bucket.over_edit += s.over_edit ? 1 : 0;
  bucket.copy_input += s.copy_input ? 1 : 0;
  bucket.empty += s.empty ? 1 : 0;
}

function toRates(counts: Counts): MetricsGroup {
  const n = counts.n || 1;
  return {
    n: counts.n,
    exact_match: +(counts.exact / n).toFixed(4),
    term_fix_rate: +(counts.term_fixed / n).toFixed(4),
    only_term_change: +(counts.only_term_change / n).toFixed(4),
    over_edit_rate: +(counts.over_edit / n).toFixed(4),
    copy_input_rate: +(counts.copy_input / n).toFixed(4),
    empty_rate: +(counts.empty / n).toFixed(4),
  };
}

interface PredLoose {
  id?: string | number;
  pred?: string;
  output?: string;
  text?: string;
}

function predTextOf(row: PredLoose | undefined): string {
  if (!row) return "";
  return row.pred ?? row.output ?? row.text ?? "";
}

function mapPreds(preds: PredLoose[]): Map<string, string> {
  const predMap = new Map<string, string>();
  preds.forEach((row, i) => {
    const key = row.id != null ? String(row.id) : String(i);
    predMap.set(key, predTextOf(row));
  });
  return predMap;
}

export function scoreGold(
  golds: SftExample[],
  preds: PredLoose[],
): { rows: ScoredRow[]; counts: Counts; bySplit: Record<string, Counts>; byType: Record<string, Counts>; byFreq: Record<string, Counts> } {
  const predMap = mapPreds(preds);
  const counts = emptyCounts();
  const bySplit: Record<string, Counts> = {};
  const byType: Record<string, Counts> = {};
  const byFreq: Record<string, Counts> = {};
  const rows: ScoredRow[] = golds.map((gold, i) => {
    const key = gold.id != null ? String(gold.id) : String(i);
    const text = predMap.has(key) ? predMap.get(key)! : predTextOf(preds[i]);
    const s = scoreOne(gold, text);
    const split = gold.split || "unknown";
    const type = gold.error_type || "unknown";
    const freq = gold.freq_bucket || "unknown";
    if (!bySplit[split]) bySplit[split] = emptyCounts();
    if (!byType[type]) byType[type] = emptyCounts();
    if (!byFreq[freq]) byFreq[freq] = emptyCounts();
    addScore(counts, s);
    addScore(bySplit[split]!, s);
    addScore(byType[type]!, s);
    addScore(byFreq[freq]!, s);
    return {
      id: gold.id ?? i,
      split,
      error_type: type,
      freq_bucket: freq,
      wrong: gold.wrong || "",
      correct: gold.correct || "",
      input: gold.input || "",
      gold: gold.output || "",
      pred: text,
      ...s,
    };
  });
  return { rows, counts, bySplit, byType, byFreq };
}

function toGrouped(table: Record<string, Counts>): Record<string, MetricsGroup> {
  return Object.fromEntries(Object.entries(table).map(([k, v]) => [k, toRates(v)]));
}

export interface EvalSlice {
  name: string;
  gold: string;
  pred: string;
}

export function listEvalSlices(cfg: ResolvedConfig): EvalSlice[] {
  return [
    { name: "eval", gold: cfg.paths.eval, pred: cfg.paths.pred },
    { name: "eval_seen_pair", gold: cfg.paths.evalSeen, pred: cfg.paths.predSeen },
    { name: "eval_unseen_pair", gold: cfg.paths.evalUnseen, pred: cfg.paths.predUnseen },
    { name: "eval_keep", gold: cfg.paths.evalKeep, pred: cfg.paths.predKeep },
  ];
}

function writeReport(report: MetricsReport, outFile: string): void {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function reportOf(
  goldFile: string,
  predFile: string,
  scoredFile: string,
  scored: ReturnType<typeof scoreGold>,
): MetricsReport {
  return {
    ...toRates(scored.counts),
    gold: goldFile,
    pred: predFile,
    scored: scoredFile,
    by_split: toGrouped(scored.bySplit),
    by_error_type: Object.keys(scored.byType).length ? toGrouped(scored.byType) : { unknown: emptyGroup() },
    by_freq_bucket: toGrouped(scored.byFreq),
  };
}

/** pred 按 id 对齐；没有 id 则按行号。写出 reports/metrics.json 与 scored.jsonl。 */
export function evaluate(cfg: ResolvedConfig, flags: EvaluateFlags = {}): MetricsReport {
  if (flags.all) return evaluateAll(cfg, flags);

  const goldFile = flags.gold || cfg.paths.eval;
  const predFile = flags.pred || cfg.paths.pred;
  const golds = readJsonl<SftExample>(goldFile);
  const preds = readJsonl<PredLoose>(predFile);
  const scored = scoreGold(golds, preds);
  const outFile = flags.output || cfg.paths.metrics;
  const scoredFile = cfg.paths.scored;
  writeJsonl(scoredFile, scored.rows);
  const report = reportOf(goldFile, predFile, scoredFile, scored);
  writeReport(report, outFile);
  console.log("[evaluate]", JSON.stringify(report, null, 2));
  console.log(`[evaluate] report=${outFile}`);
  console.log(`[evaluate] scored=${scoredFile}`);
  return report;
}

/** 对 eval / seen / unseen / keep 分别打分，汇总进同一份 metrics.json。 */
export function evaluateAll(cfg: ResolvedConfig, flags: EvaluateFlags = {}): MetricsReport {
  const slices: Record<string, MetricsGroup> = {};
  let main: MetricsReport | null = null;
  const allScored: ScoredRow[] = [];

  for (const slice of listEvalSlices(cfg)) {
    if (!fs.existsSync(slice.gold) || !fs.existsSync(slice.pred)) continue;
    const golds = readJsonl<SftExample>(slice.gold);
    const preds = readJsonl<PredLoose>(slice.pred);
    if (!golds.length) continue;
    const scored = scoreGold(golds, preds);
    allScored.push(...scored.rows);
    const piece = reportOf(slice.gold, slice.pred, cfg.paths.scored, scored);
    slices[slice.name] = {
      n: piece.n,
      exact_match: piece.exact_match,
      term_fix_rate: piece.term_fix_rate,
      only_term_change: piece.only_term_change,
      over_edit_rate: piece.over_edit_rate,
      copy_input_rate: piece.copy_input_rate,
      empty_rate: piece.empty_rate,
    };
    if (slice.name === "eval") main = piece;
    console.log(`[evaluate] slice=${slice.name} n=${piece.n} exact=${piece.exact_match} term_fix=${piece.term_fix_rate} over_edit=${piece.over_edit_rate}`);
  }

  if (!main) {
    throw new Error("evaluate --all 需要先有 eval/eval.jsonl 与 infer/pred.jsonl。请先 split，再 infer 或 evaluate --baseline。");
  }

  writeJsonl(cfg.paths.scored, allScored);
  main.slices = slices;
  const outFile = flags.output || cfg.paths.metrics;
  writeReport(main, outFile);
  console.log("[evaluate]", JSON.stringify(main, null, 2));
  console.log(`[evaluate] report=${outFile}`);
  return main;
}

/** 规则基线：input 里把 wrong 全部换成 correct，写出 pred.jsonl。 */
export function ruleBaseline(goldFile: string, predFile: string): string {
  const golds = readJsonl<SftExample>(goldFile);
  const preds: PredictionRow[] = golds.map((g, i) => ({
    id: g.id ?? i,
    pred: g.wrong && g.correct ? String(g.input || "").split(g.wrong).join(g.correct) : g.output,
  }));
  writeJsonl(predFile, preds);
  return predFile;
}

export function ruleBaselineAll(cfg: ResolvedConfig): string[] {
  const written: string[] = [];
  for (const slice of listEvalSlices(cfg)) {
    if (!fs.existsSync(slice.gold)) continue;
    ruleBaseline(slice.gold, slice.pred);
    written.push(slice.pred);
    console.log(`[baseline] ${slice.name} -> ${slice.pred}`);
  }
  return written;
}

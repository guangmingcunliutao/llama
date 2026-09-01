import { createHash } from "node:crypto";

export interface PairRef {
  wrong: string;
  correct: string;
}

export function pairKey(pair: PairRef): string {
  return `${pair.wrong}\t${pair.correct}`;
}

/** 与行序无关的词对集合指纹，用于判断同一种子是否追加了内容。 */
export function fingerprintPairs(pairs: PairRef[]): string {
  const keys = [...new Set(pairs.map(pairKey))].sort();
  return createHash("sha256").update(keys.join("\n")).digest("hex");
}

export function diffPairSets(
  previous: PairRef[],
  next: PairRef[],
): { added: PairRef[]; removed: PairRef[]; kept: PairRef[] } {
  const prev = new Map(previous.map((p) => [pairKey(p), p]));
  const nxt = new Map(next.map((p) => [pairKey(p), p]));
  const added: PairRef[] = [];
  const kept: PairRef[] = [];
  const removed: PairRef[] = [];
  for (const [key, pair] of nxt) {
    if (prev.has(key)) kept.push(pair);
    else added.push(pair);
  }
  for (const [key, pair] of prev) {
    if (!nxt.has(key)) removed.push(pair);
  }
  return { added, removed, kept };
}

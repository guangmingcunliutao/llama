/** 比较训练句与验证句是否泄漏时去掉空白。 */
export function normalizeSentence(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

export function sentenceKeySet(sentences: string[]): Set<string> {
  return new Set(sentences.map(normalizeSentence).filter(Boolean));
}

export function leaksIntoTrain(evalSentences: string[], trainSentences: string[]): string[] {
  const train = sentenceKeySet(trainSentences);
  const leaked: string[] = [];
  const seen = new Set<string>();
  for (const sent of evalSentences) {
    const key = normalizeSentence(sent);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (train.has(key)) leaked.push(sent);
  }
  return leaked;
}

/** 按「最终数据集中正常样本占比」计算要追加的 keep 条数。 */
export function cleanSampleCount(errorCount: number, cleanRatio: number): number {
  if (errorCount <= 0 || cleanRatio <= 0) return 0;
  if (cleanRatio >= 1) return errorCount;
  return Math.round((errorCount * cleanRatio) / (1 - cleanRatio));
}

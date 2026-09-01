/** 程序化入口。日常使用请走 `mtrain` 命令（仓库根 pnpm build 后 pnpm mtrain）。 */
export { defineConfig, findRepoRoot, loadUserConfig } from "./config.js";
export { defaultUserConfig } from "./defaultConfig.js";
export { generateEval } from "./generateEval.js";
export { generate, collectSentences } from "./generate.js";
export { prepareDict } from "./prepare.js";
export { countJsonl } from "./jsonl.js";
export { ExclusiveJob } from "./jobLock.js";
export {
  ensureTrainYaml,
  prepareTrainFiles,
  runTrain,
  startTrainFromConfig,
  writeDatasetInfo,
} from "./trainJob.js";
export { availableSourceTypes, SOURCE_TYPES } from "./sources/registry.js";
export { toShareGpt, toMessages, parseFormats } from "./format.js";
export { normalizeRow, normalizeRows, readDatasetRows, pairKeyForRow, toLfShareGpt, toLfAlpaca } from "./normalize.js";
export { infer } from "./infer.js";
export { evaluate, evaluateAll, ruleBaselineAll } from "./evaluate.js";
export { analyze } from "./analyze.js";
export { parseTrainYaml } from "./trainYaml.js";
export { exportLf } from "./exportLf.js";
export type {
  HttpSourceConfig,
  HttpSourceOptions,
  InferBackend,
  InferConfig,
  LocalJsonlSourceConfig,
  LocalJsonlSourceOptions,
  RateConfig,
  ResolvedConfig,
  SftFormat,
  SourceConfig,
  SourceType,
  SplitConfig,
  TrainConfig,
  TrainHyperParams,
  TrainKnobs,
  UserConfig,
  UserConfigContext,
  UserConfigExport,
  UserConfigFn,
} from "./types.js";

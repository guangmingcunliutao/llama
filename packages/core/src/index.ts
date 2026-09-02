/** 程序化入口。日常使用请走 `mtrain` 命令（仓库根 pnpm build 后 pnpm mtrain）。 */
export { defineConfig, findRepoRoot, loadUserConfig, normalizeSources } from "./config.js";
export { defaultUserConfig } from "./defaultConfig.js";
export { generateEval } from "./generateEval.js";
export { generate, collectSentences } from "./generate.js";
export { materializeEvalSlices } from "./evalSlices.js";
export { pidAlive, killProcessTree } from "./killTree.js";
export {
  createRun,
  dataRunPaths,
  deleteRun,
  evalRunPaths,
  fingerprintFile,
  fingerprintValue,
  listRuns,
  loadWorkspace,
  patchWorkspace,
  readDataProgress,
  readRun,
  requireDataRun,
  requireTrainRun,
  selectRun,
  summarizeRun,
  tailLog,
  trainRunPaths,
} from "./runs/index.js";
export type { RunKind, RunMeta, RunMode, RunSummary, WorkspacePointer } from "./runs/index.js";
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
export { decodeSubprocessBuffer, detectLlamaFactory, findBash, findGit, findSystemPython, looksLikeLlamaFactoryHome, trainSpawnSpec } from "./llamaFactoryEnv.js";
export { installLlamaFactory, locateInstallScript } from "./llamaFactoryInstall.js";
export { isJobCancelled, JobCancelledError } from "./abort.js";
export type { LlamaFactoryDetect } from "./llamaFactoryEnv.js";
export { availableSourceTypes, SOURCE_TYPES } from "./sources/registry.js";
export { sourceDisplay } from "./sources/display.js";
export { PEOPLE_SEARCH_DISPLAY } from "./sources/peopleDefaults.js";
export { toShareGpt, toMessages, parseFormats } from "./format.js";
export { normalizeRow, normalizeRows, readDatasetRows, pairKeyForRow, toLfShareGpt, toLfAlpaca } from "./normalize.js";
export { infer } from "./infer.js";
export { evaluate, evaluateAll, ruleBaselineAll } from "./evaluate.js";
export { analyze } from "./analyze.js";
export {
  applyModelHubEnv,
  inferModelHub,
  listFsDir,
  listFsRoots,
  looksLikeHfModelDir,
  looksLikeLocalModelPath,
  parseModelHub,
  validateModelSource,
} from "./modelSource.js";
export type { ModelHub } from "./modelSource.js";
export { parseTrainYaml } from "./trainYaml.js";
export { detectQuantTools, findConvertNear, quantizeSource, resolveConvertScript, resolveLlamaQuantize } from "./quant.js";
export type { QuantDetect, QuantizeFlags } from "./quant.js";
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

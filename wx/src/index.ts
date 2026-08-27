/** 程序化入口。日常使用请走 `termcorr` 命令（需先 pnpm build，并 pnpm link --global 或在工作区 pnpm install）。 */
export { defineConfig, loadUserConfig } from "./config.js";
export { availableSourceTypes, SOURCE_TYPES } from "./sources/registry.js";
export { toShareGpt } from "./format.js";
export type {
  HttpSourceOptions,
  InferConfig,
  LocalJsonlSourceOptions,
  ResolvedConfig,
  SftFormat,
  SourceConfig,
  SourceType,
  UserConfig,
  UserConfigExport,
} from "./types.js";

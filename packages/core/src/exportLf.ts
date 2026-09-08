import path from "node:path";
import { exportLfBoard } from "./lfHandoff.js";
import type { ExportLfFlags, ExportLfResult, ResolvedConfig } from "./types.js";

/** 将当前数据实验导出为 LlamaFactory WebUI 的 dataset_dir（term_train / term_eval）。 */
export function exportLf(cfg: ResolvedConfig, flags: ExportLfFlags = {}): ExportLfResult {
  const datasetDir = flags.datasetDir
    ? path.isAbsolute(flags.datasetDir)
      ? flags.datasetDir
      : path.resolve(cfg.root, flags.datasetDir)
    : cfg.lfExportDir;
  return exportLfBoard(cfg, datasetDir);
}

import { exportLfBoard } from "./lfHandoff.js";
import type { ExportLfFlags, ExportLfResult, ResolvedConfig } from "./types.js";

/** 在当前数据实验目录写 dataset_info，并同步 llamaboard train.dataset_dir（不再另拷到 outputs/lf）。 */
export function exportLf(cfg: ResolvedConfig, _flags: ExportLfFlags = {}): ExportLfResult {
  return exportLfBoard(cfg);
}

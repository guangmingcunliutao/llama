/**
 * 把已经整理好的训练 jsonl 导入为一次数据实验，并按词对划分验证集。
 * 支持 messages / alpaca / sharegpt，不走检索。
 */
import fs from "node:fs";
import path from "node:path";
import { writeJsonl, readJsonl } from "./jsonl.js";
import { normalizeRows, readDatasetRows } from "./normalize.js";
import { fingerprintValue } from "./runs/fingerprint.js";
import { dataRunPaths } from "./runs/paths.js";
import {
  appendRunLog,
  createRun,
  emptyProgress,
  patchRun,
  patchWorkspace,
  writeDataParams,
  writeDataProgress,
} from "./runs/store.js";
import { dataParamsFrom } from "./runs/dataSession.js";
import { splitDataset } from "./split.js";
import type { ImportReadyFlags, ImportReadyResult, ResolvedConfig, SftExample } from "./types.js";

function resolveInput(cfg: ResolvedConfig, flags: ImportReadyFlags): string {
  const input = flags.input || cfg.importSource;
  if (!input) throw new Error("请指定要导入的训练文件");
  const inputPath = path.isAbsolute(input) ? input : path.resolve(cfg.root, input);
  if (!fs.existsSync(inputPath)) throw new Error(`导入文件不存在: ${inputPath}`);
  return inputPath;
}

function labelFrom(file: string, explicit?: string): string {
  const given = explicit?.trim();
  if (given) return given;
  const stem = path.parse(file).name.replace(/[^\w.\u4e00-\u9fa5-]+/g, "-").slice(0, 40);
  return stem || "导入训练";
}

export function importReadyTrain(cfg: ResolvedConfig, flags: ImportReadyFlags = {}): ImportReadyResult {
  const inputPath = resolveInput(cfg, flags);
  const rows = normalizeRows(readDatasetRows(inputPath, flags.limit), { instruction: cfg.instruction });
  if (!rows.length) {
    throw new Error(`未能从 ${inputPath} 解析出有效样本（支持 messages / alpaca / sharegpt）`);
  }

  const label = labelFrom(inputPath, flags.label);
  const params = dataParamsFrom(cfg, { sources: ["import"], label });
  const meta = createRun(cfg.outDir, {
    kind: "data",
    mode: "fresh",
    label,
    extra: { phase: "generating_train", paramsFingerprint: fingerprintValue(params) },
  });
  const paths = dataRunPaths(cfg.outDir, meta.id);
  writeDataParams(cfg.outDir, meta.id, params);
  writeDataProgress(cfg.outDir, meta.id, emptyProgress("generating_train"));
  patchWorkspace(cfg.outDir, { dataRunId: meta.id });

  const log = (line: string): void => {
    console.log(line);
    appendRunLog(paths.logs, line);
  };

  try {
    const importedFile = path.join(paths.dir, "imported.jsonl");
    writeJsonl(importedFile, rows);
    log(`[import] ${inputPath} -> ${importedFile} (${rows.length} rows)`);

    const patched: ResolvedConfig = {
      ...cfg,
      paths: {
        ...cfg.paths,
        sft: importedFile,
        trainSplit: paths.train,
        trainSplitSharegpt: paths.trainSharegpt,
        eval: paths.eval,
        evalSeen: paths.evalSeen,
        evalUnseen: paths.evalUnseen,
        evalKeep: paths.evalKeep,
        splitReport: paths.splitReport,
      },
    };
    const report = splitDataset(patched, {
      input: importedFile,
      trainOut: paths.train,
      evalOut: paths.eval,
    });
    if (!report.train) {
      throw new Error("划分后训练集为空。请增加样本，或检查句子是否几乎全部重复。");
    }

    const evalRows = readJsonl<SftExample>(paths.eval, "empty");
    const keepRows = readJsonl<SftExample>(paths.evalKeep, "empty");
    writeJsonl(paths.evalRaw, [...evalRows, ...keepRows]);
    fs.writeFileSync(
      path.join(paths.evalDir, "README.md"),
      `# 验证集（由上传的训练集划分）\n\n` +
        `- eval.jsonl（纠错全集 seen+unseen）：${report.eval}\n` +
        `- eval_seen_pair.jsonl（词对见过、句子没见过）：${report.eval_seen_pair}\n` +
        `- eval_unseen_pair.jsonl（词对未进训练）：${report.eval_unseen_pair}\n` +
        `- eval_keep.jsonl（规范句，不应改）：${report.eval_keep}\n\n` +
        `来源文件: ${inputPath}\n导入条数: ${rows.length}，训练保留 ${report.train}。\n`,
      "utf8",
    );

    const progress = emptyProgress("completed");
    progress.writtenError = report.train;
    progress.evalWritten = report.eval;
    progress.evalKeep = report.eval_keep;
    writeDataProgress(cfg.outDir, meta.id, progress);
    patchRun(cfg.outDir, "data", meta.id, {
      status: "completed",
      phase: "completed",
      pid: null,
      exitCode: 0,
      error: null,
    });
    log(
      `[import] run=${meta.id} train=${report.train} eval=${report.eval} seen=${report.eval_seen_pair} unseen=${report.eval_unseen_pair} keep=${report.eval_keep}`,
    );
    return {
      runId: meta.id,
      label,
      input: inputPath,
      imported: rows.length,
      train: report.train,
      eval: report.eval,
      eval_seen_pair: report.eval_seen_pair,
      eval_unseen_pair: report.eval_unseen_pair,
      eval_keep: report.eval_keep,
    };
  } catch (err) {
    patchRun(cfg.outDir, "data", meta.id, {
      status: "failed",
      phase: "generating_train",
      pid: null,
      exitCode: 1,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

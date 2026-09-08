import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadUserConfig } from "../config.js";
import {
  exportLfBoard,
  exportLfBoardForDataRun,
  listLfArtifacts,
  prepareLfRun,
  prepareLfEval,
  resolveArtifact,
  syncLlamaboardDatasetDir,
  TERM_EVAL,
  TERM_TRAIN,
} from "../lfHandoff.js";
import { countJsonl } from "../jsonl.js";
import { createRun, patchWorkspace } from "../runs/store.js";
import { dataRunPaths } from "../runs/paths.js";

function sampleRow(input: string, output: string) {
  return JSON.stringify({
    instruction: "改",
    input,
    output,
    error_type: "t",
    wrong: "错",
    correct: "对",
    source: "x",
    url: "",
    article_id: "",
  });
}

async function seedData(dir: string, withEval: boolean) {
  fs.writeFileSync(
    path.join(dir, "model-training.config.json"),
    `${JSON.stringify({ outDir: "./outputs", sources: [], llamafactory: { home: "./LlamaFactory" } })}\n`,
    "utf8",
  );
  fs.mkdirSync(path.join(dir, "LlamaFactory"), { recursive: true });
  const cfg0 = await loadUserConfig({ command: "status", cwd: dir });
  const data = createRun(cfg0.outDir, { kind: "data", mode: "fresh", label: "seed" });
  const paths = dataRunPaths(cfg0.outDir, data.id);
  fs.mkdirSync(paths.evalDir, { recursive: true });
  fs.writeFileSync(paths.train, `${sampleRow("错句一", "对句一")}\n${sampleRow("错句二", "对句二")}\n`, "utf8");
  if (withEval) {
    fs.writeFileSync(paths.eval, `${sampleRow("错句三", "对句三")}\n`, "utf8");
  }
  patchWorkspace(cfg0.outDir, { dataRunId: data.id });
  return loadUserConfig({ command: "export-lf", cwd: dir });
}

describe("lfHandoff", () => {
  it("writes dataset_info into the data run dir without copying jsonl", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-lf-ex-"));
    const cfg = await seedData(dir, true);
    const dataId = JSON.parse(fs.readFileSync(path.join(cfg.outDir, "workspace.json"), "utf8")).dataRunId as string;
    const paths = dataRunPaths(cfg.outDir, dataId);
    const result = exportLfBoard(cfg);
    expect(result.datasetDir).toBe(paths.dir);
    expect(result.datasets).toEqual([TERM_TRAIN, TERM_EVAL]);
    const info = JSON.parse(fs.readFileSync(path.join(paths.dir, "dataset_info.json"), "utf8")) as Record<
      string,
      { file_name: string }
    >;
    expect(info[TERM_TRAIN]?.file_name).toBe("train.jsonl");
    expect(info[TERM_EVAL]?.file_name).toBe("eval/eval.jsonl");
    expect(countJsonl(paths.train)).toBe(2);
    expect(fs.existsSync(path.join(cfg.lfExportDir, "by-run"))).toBe(false);
  });

  it("omits term_eval when there is no eval file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-lf-noeval-"));
    const cfg = await seedData(dir, false);
    const result = exportLfBoard(cfg);
    expect(result.datasets).toEqual([TERM_TRAIN]);
    const info = JSON.parse(fs.readFileSync(path.join(result.datasetDir, "dataset_info.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(info[TERM_EVAL]).toBeUndefined();
  });

  it("two data runs each keep their own dataset_info; no shared overwrite", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-lf-multi-"));
    const cfg1 = await seedData(dir, false);
    const id1 = JSON.parse(fs.readFileSync(path.join(cfg1.outDir, "workspace.json"), "utf8")).dataRunId as string;
    exportLfBoard(cfg1);

    const data2 = createRun(cfg1.outDir, { kind: "data", mode: "fresh", label: "second" });
    const paths2 = dataRunPaths(cfg1.outDir, data2.id);
    fs.mkdirSync(paths2.evalDir, { recursive: true });
    fs.writeFileSync(paths2.train, `${sampleRow("错句新", "对句新")}\n`, "utf8");
    patchWorkspace(cfg1.outDir, { dataRunId: data2.id });
    const cfg2 = await loadUserConfig({ command: "export-lf", cwd: dir });
    exportLfBoard(cfg2);

    expect(fs.existsSync(path.join(dataRunPaths(cfg2.outDir, id1).dir, "dataset_info.json"))).toBe(true);
    expect(fs.existsSync(path.join(paths2.dir, "dataset_info.json"))).toBe(true);
    expect(countJsonl(dataRunPaths(cfg2.outDir, id1).train)).toBe(2);
    expect(countJsonl(paths2.train)).toBe(1);
  });

  it("tryExportLfBoard follows workspace even when cfg.paths still point at .unselected", async () => {
    const { tryExportLfBoard } = await import("../lfHandoff.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-lf-stale-"));
    const cfg = await seedData(dir, false);
    const stale = {
      ...cfg,
      paths: {
        ...cfg.paths,
        trainSplit: path.join(cfg.outDir, "data", ".unselected", "train.jsonl"),
      },
    };
    expect(fs.existsSync(stale.paths.trainSplit)).toBe(false);
    const result = tryExportLfBoard(stale);
    expect(result?.datasets).toContain(TERM_TRAIN);
    expect(fs.existsSync(path.join(result!.datasetDir, "dataset_info.json"))).toBe(true);
  });

  it("syncs train.dataset_dir into llamaboard_config yaml", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-lf-yaml-"));
    const cfg = await seedData(dir, false);
    const dataId = JSON.parse(fs.readFileSync(path.join(cfg.outDir, "workspace.json"), "utf8")).dataRunId as string;
    const datasetDir = dataRunPaths(cfg.outDir, dataId).dir;
    const home = path.join(dir, "LlamaFactory");
    const configDir = path.join(home, "llamaboard_config");
    fs.mkdirSync(configDir, { recursive: true });
    const yamlPath = path.join(configDir, "2026-09-08-15-43-30.yaml");
    fs.writeFileSync(yamlPath, "train.dataset_dir: E:/old/path\ntrain.dataset:\n- term_train\n", "utf8");
    const synced = syncLlamaboardDatasetDir(home, datasetDir);
    expect(synced).toBe(yamlPath);
    const text = fs.readFileSync(yamlPath, "utf8");
    expect(text).toContain(`train.dataset_dir: ${datasetDir.replaceAll("\\", "/")}`);
    expect(text).not.toContain("E:/old/path");
  });

  it("prepares output dir with meta beside it, not inside", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-lf-prep-"));
    const cfg = await seedData(dir, true);
    const prepared = prepareLfRun(cfg, { label: "lr1e4" });
    expect(fs.existsSync(prepared.outputDir)).toBe(true);
    expect(fs.existsSync(path.join(prepared.outputDir, "mtrain.json"))).toBe(false);
    const metaFile = path.join(cfg.outDir, "lf-meta", `${prepared.id}.json`);
    expect(fs.existsSync(metaFile)).toBe(true);
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as { dataRunId: string; dataFingerprint: string };
    expect(meta.dataRunId).toBeTruthy();
    expect(meta.dataFingerprint).toMatch(/^sha256:/);
    const listed = listLfArtifacts(cfg.outDir);
    expect(listed.some((row) => row.id === prepared.id && !row.adapterReady)).toBe(true);
    expect(resolveArtifact(cfg.outDir, prepared.id)?.dataRunId).toBe(meta.dataRunId);
  });

  it("prepares eval output dir for LlamaFactory Evaluate", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-lf-eval-"));
    const cfg = await seedData(dir, true);
    const prepared = prepareLfRun(cfg, { label: "evalslot" });
    fs.writeFileSync(path.join(prepared.outputDir, "adapter_config.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(prepared.outputDir, "adapter_model.safetensors"), "", "utf8");
    const evalPrep = prepareLfEval(cfg, { trainRunId: prepared.id, label: "webui-eval" });
    expect(evalPrep.evalDataset).toBe(TERM_EVAL);
    expect(fs.existsSync(evalPrep.outputDir)).toBe(true);
    expect(evalPrep.adapterDir).toBe(prepared.outputDir);
    expect(evalPrep.datasetDir).toContain(`${path.sep}data${path.sep}`);
  });
});

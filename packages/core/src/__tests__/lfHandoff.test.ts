import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadUserConfig } from "../config.js";
import {
  exportLfBoard,
  listLfArtifacts,
  prepareLfRun,
  prepareLfEval,
  resolveArtifact,
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
    `${JSON.stringify({ outDir: "./outputs", sources: [] })}\n`,
    "utf8",
  );
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
  it("exports alpaca term_train/term_eval and writes manifest outside runs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-lf-ex-"));
    const cfg = await seedData(dir, true);
    const result = exportLfBoard(cfg);
    expect(result.datasets).toEqual([TERM_TRAIN, TERM_EVAL]);
    const info = JSON.parse(fs.readFileSync(path.join(result.datasetDir, "dataset_info.json"), "utf8")) as Record<
      string,
      { file_name: string }
    >;
    expect(info[TERM_TRAIN]?.file_name).toBe(`train/${TERM_TRAIN}.jsonl`);
    expect(info[TERM_EVAL]?.file_name).toBe(`eval/${TERM_EVAL}.jsonl`);
    expect(countJsonl(path.join(result.datasetDir, "train", `${TERM_TRAIN}.jsonl`))).toBe(2);
    const manifest = JSON.parse(fs.readFileSync(path.join(result.datasetDir, "manifest.json"), "utf8")) as {
      trainRows: number;
      evalRows: number;
    };
    expect(manifest.trainRows).toBe(2);
    expect(manifest.evalRows).toBe(1);
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
  });
});

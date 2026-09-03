import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprintValue } from "../runs/fingerprint.js";
import { createRun, listRuns, loadWorkspace, patchWorkspace, summarizeRun } from "../runs/store.js";
import { resumeBlockedReason } from "../runs/trainResume.js";
import { hasLoraAdapter, resolveLoraAdapterDir } from "../runs/adapter.js";

describe("runs store", () => {
  it("creates a data run and lists it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-runs-"));
    const meta = createRun(dir, { kind: "data", mode: "fresh", label: "demo" });
    expect(meta.id).toMatch(/demo/);
    expect(fs.existsSync(path.join(dir, "data", meta.id, "run.json"))).toBe(true);
    patchWorkspace(dir, { dataRunId: meta.id });
    expect(loadWorkspace(dir).dataRunId).toBe(meta.id);
    const listed = listRuns(dir, "data");
    expect(listed[0]?.id).toBe(meta.id);
    expect(summarizeRun(dir, meta).canResume).toBe(false);
  });

  it("fingerprints params stably", () => {
    expect(fingerprintValue({ b: 1, a: 2 })).toBe(fingerprintValue({ a: 2, b: 1 }));
  });

  it("blocks resume when locked knobs change", () => {
    const reason = resumeBlockedReason({ learning_rate: "1e-4" }, { learning_rate: "2e-4" });
    expect(reason).toMatch(/learning_rate/);
    expect(resumeBlockedReason({ learning_rate: "1e-4" }, { learning_rate: "1e-4" })).toBeNull();
    expect(resumeBlockedReason({ num_train_epochs: 1 }, { num_train_epochs: 1.0 })).toBeNull();
    expect(resumeBlockedReason({ learning_rate: "1.0e-4" }, { learning_rate: 0.0001 })).toBeNull();
  });
});

describe("lora adapter lookup", () => {
  it("finds adapter inside checkpoint-N", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-adapter-"));
    const ckpt = path.join(dir, "ckpt");
    const step = path.join(ckpt, "checkpoint-50");
    fs.mkdirSync(step, { recursive: true });
    fs.writeFileSync(path.join(step, "adapter_config.json"), "{}");
    expect(hasLoraAdapter(ckpt)).toBe(false);
    expect(resolveLoraAdapterDir(ckpt)).toBe(step);
  });
});

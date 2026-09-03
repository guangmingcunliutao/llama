import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadUserConfig } from "../config.js";
import { importReadyTrain } from "../importReady.js";
import { readJsonl } from "../jsonl.js";
import { normalizeRow } from "../normalize.js";
import { dataRunPaths } from "../runs/paths.js";
import type { SftExample } from "../types.js";

function messagesRow(input: string, output: string) {
  return {
    messages: [
      { role: "system", content: "你是校对助手。只输出句子本身。" },
      { role: "user", content: input },
      { role: "assistant", content: output },
    ],
  };
}

describe("importReadyTrain", () => {
  it("reads messages jsonl, creates a data run, and holds eval sentences out of train", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-import-"));
    const rows = [
      messagesRow("习总书记出席会议。", "习近平总书记出席会议。"),
      messagesRow("习总书记发表讲话。", "习近平总书记发表讲话。"),
      messagesRow("习总书记到基层调研。", "习近平总书记到基层调研。"),
      messagesRow("习总书记回信勉励官兵。", "习近平总书记回信勉励官兵。"),
      messagesRow("庆祝建国七十六周年。", "庆祝中华人民共和国成立七十六周年。"),
      messagesRow("纪念建国纪念日。", "纪念中华人民共和国成立纪念日。"),
      messagesRow("举办建国招待会。", "举办中华人民共和国成立招待会。"),
      messagesRow("一带一路沿线国家贸易增长。", "“一带一路”共建国家贸易增长。"),
      messagesRow("与一带一路沿线深化合作。", "与“一带一路”共建深化合作。"),
      messagesRow("面向一带一路沿线开放。", "面向“一带一路”共建开放。"),
    ];
    const input = path.join(dir, "ready.jsonl");
    fs.writeFileSync(input, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
    fs.writeFileSync(
      path.join(dir, "model-training.config.json"),
      `${JSON.stringify({ outDir: "./outputs", instruction: "fallback" })}\n`,
      "utf8",
    );

    const cfg = await loadUserConfig({ command: "import", cwd: dir });
    const result = importReadyTrain(cfg, { input, label: "现成训练" });
    expect(result.imported).toBe(10);
    expect(result.train).toBeGreaterThan(0);
    expect(result.eval).toBeGreaterThan(0);
    expect(result.train + result.eval).toBeLessThanOrEqual(10);

    const paths = dataRunPaths(cfg.outDir, result.runId);
    expect(fs.existsSync(paths.train)).toBe(true);
    expect(fs.existsSync(paths.eval)).toBe(true);
    expect(fs.existsSync(paths.evalSeen) || fs.existsSync(paths.evalUnseen)).toBe(true);

    const train = readJsonl<SftExample>(paths.train);
    const evalRows = readJsonl<SftExample>(paths.eval);
    const trainOutputs = new Set(train.map((row) => row.output));
    expect(evalRows.some((row) => trainOutputs.has(row.output))).toBe(false);
    expect(train[0]?.instruction).toContain("校对助手");
  });

  it("normalizes a messages triple like LlamaFactory SFT", () => {
    const row = normalizeRow(
      messagesRow(
        "我国与一带一路沿线国家的货物贸易总额接近2.9万亿美元。",
        "我国与“一带一路”共建国家的货物贸易总额接近2.9万亿美元。",
      ),
    );
    expect(row?.input).toContain("一带一路沿线");
    expect(row?.output).toContain("“一带一路”共建");
    expect(row?.instruction).toContain("校对助手");
    expect(row?.wrong).toBeTruthy();
    expect(row?.correct).toBeTruthy();
  });
});

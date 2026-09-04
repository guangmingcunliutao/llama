import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { cellText, prepareDict } from "../prepare.js";
import { readJsonl } from "../jsonl.js";
import type { TermPair } from "../types.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

function writeXlsx(file: string, rows: string[][]): void {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  XLSX.writeFile(wb, file);
}

describe("cellText", () => {
  it("keeps dunhao and collapses inner newlines", () => {
    expect(cellText("坚持党要管党、从严治党")).toBe("坚持党要管党、从严治党");
    expect(cellText(" 坚持党要管党、\n从严治党 ")).toBe("坚持党要管党、从严治党");
  });
});

describe("prepareDict", () => {
  it("treats one spreadsheet row as one pair and does not split on dunhao", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-prep-"));
    const input = path.join(dir, "pairs.xlsx");
    const output = path.join(dir, "term_pairs.jsonl");
    writeXlsx(input, [
      ["错误词", "建议更正词"],
      ["坚持党要管党、从严治党", "坚持党要管党、全面从严治党"],
      ["道路自信、理论自信、制度自信、文化自信", "四个自信"],
      ["习总书记", "习近平总书记"],
      ["习总书记", "习近平总书记"],
    ]);
    const report = prepareDict({ input, output, force: true });
    const pairs = readJsonl<TermPair>(output);
    expect(report.raw_rows).toBe(4);
    expect(report.unique_pairs).toBe(3);
    expect(report.dropped_same).toBe(0);
    expect(pairs.some((p) => p.wrong === "坚持党要管党、从严治党" && p.correct === "坚持党要管党、全面从严治党")).toBe(
      true,
    );
    expect(pairs.some((p) => p.wrong === "从严治党")).toBe(false);
    expect(pairs.find((p) => p.wrong === "习总书记")?.freq).toBe(2);
  });
});

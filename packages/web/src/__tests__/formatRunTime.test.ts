import { describe, expect, it } from "vitest";
import { formatRunTime } from "../runs/format";

describe("formatRunTime", () => {
  it("renders local wall clock instead of UTC digits", () => {
    const iso = "2026-09-04T08:29:08.691Z";
    const shown = formatRunTime(iso);
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const naiveUtc = iso.replace("T", " ").slice(0, 19);
    if (new Date().getTimezoneOffset() !== 0) {
      expect(shown).not.toBe(naiveUtc);
    }
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(shown).toBe(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    );
  });

  it("falls back for empty or invalid values", () => {
    expect(formatRunTime(undefined)).toBe("—");
    expect(formatRunTime("")).toBe("—");
    expect(formatRunTime("not-a-date")).toBe("not-a-date");
  });
});

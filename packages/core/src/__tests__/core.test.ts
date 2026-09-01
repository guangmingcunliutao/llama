import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { groupByCorrect, loadDictionary, mergeTermPairs } from "../dictionary.js";
import { parseFormats, toMessages, toShareGpt, wantsShareGpt } from "../format.js";
import { generateEval } from "../generateEval.js";
import { collectSentences } from "../generate.js";
import { cleanSampleCount } from "../generateMix.js";
import { interpolate } from "../interpolate.js";
import { ExclusiveJob } from "../jobLock.js";
import { countJsonl, readJsonl, readJsonOrJsonl } from "../jsonl.js";
import { diffPairSets, fingerprintPairs } from "../seedFingerprint.js";
import { leaksIntoTrain, normalizeSentence } from "../sentenceNorm.js";
import { goodSentence, htmlToText, splitSentences } from "../text.js";
import { ensureTrainYaml, startTrainFromConfig, writeDatasetInfo } from "../trainJob.js";
import { parseTrainYaml, patchTrainYaml } from "../trainYaml.js";
import { isRecord } from "../util.js";
import { findRepoRoot, loadUserConfig, normalizeSources } from "../config.js";
import { sourceDisplay } from "../sources/display.js";
import { selectSources } from "../sources/registry.js";

describe("mergeTermPairs", () => {
  it("drops identical and empty pairs, merges freq", () => {
    const pairs = mergeTermPairs([
      { 错误词: "习总书记", 建议更正词: "习近平总书记", freq: 2 },
      { wrong: "习总书记", correct: "习近平总书记", freq: 3 },
      { wrong: "x", correct: "x" },
      { wrong: "", correct: "a" },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.freq).toBe(5);
  });

  it("groups by correct term", () => {
    const grouped = groupByCorrect([
      { wrong: "a", correct: "A", error_type: "t", freq: 1 },
      { wrong: "b", correct: "A", error_type: "t", freq: 1 },
    ]);
    expect(grouped.get("A")).toHaveLength(2);
  });
});

describe("loadDictionary", () => {
  it("reads csv with chinese headers", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-dict-"));
    const file = path.join(dir, "p.csv");
    fs.writeFileSync(file, "错误词,建议更正词\n错,对\n", "utf8");
    const pairs = loadDictionary(file);
    expect(pairs[0]).toMatchObject({ wrong: "错", correct: "对" });
  });
});

describe("formats", () => {
  it("defaults to messages and accepts alpaca", () => {
    expect(parseFormats(undefined)).toEqual(["messages"]);
    expect(parseFormats("alpaca,messages")).toEqual(["alpaca", "messages"]);
    expect(() => parseFormats("foo")).toThrow(/未知 SFT 格式/);
  });

  it("builds messages triple", () => {
    const row = toMessages({
      instruction: "sys",
      input: "bad",
      output: "good",
      id: "1",
    });
    expect(row.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
  });
});

describe("seed fingerprint", () => {
  it("ignores pair order", () => {
    const a = fingerprintPairs([
      { wrong: "w1", correct: "c" },
      { wrong: "w2", correct: "c" },
    ]);
    const b = fingerprintPairs([
      { wrong: "w2", correct: "c" },
      { wrong: "w1", correct: "c" },
    ]);
    expect(a).toBe(b);
  });

  it("detects appended pairs", () => {
    const prev = [{ wrong: "w1", correct: "c" }];
    const next = [
      { wrong: "w1", correct: "c" },
      { wrong: "w2", correct: "c" },
    ];
    const diff = diffPairSets(prev, next);
    expect(diff.added).toEqual([{ wrong: "w2", correct: "c" }]);
    expect(diff.kept).toHaveLength(1);
    expect(diff.removed).toHaveLength(0);
  });
});

describe("eval leakage", () => {
  it("treats whitespace-only difference as leak", () => {
    const leaked = leaksIntoTrain(["你好 世界。"], ["你好世界。"]);
    expect(leaked).toHaveLength(1);
    expect(normalizeSentence("a  b")).toBe("ab");
  });

  it("allows new sentences", () => {
    expect(leaksIntoTrain(["新句子。"], ["旧句子。"])).toEqual([]);
  });
});

describe("text", () => {
  it("strips tags and splits sentences", () => {
    expect(htmlToText("<p>甲。</p><p>乙！</p>")).toContain("甲");
    const sents = splitSentences("甲同志到会。乙同志发言！");
    expect(sents.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects noisy or link sentences", () => {
    expect(goodSentence("请登录查看详情习近平总书记", "习近平总书记")).toBe(false);
    expect(goodSentence("http://example.com 习近平总书记到会", "习近平总书记")).toBe(false);
    expect(goodSentence("今天习近平总书记出席会议并发表重要讲话。", "习近平总书记")).toBe(true);
  });
});

describe("interpolate", () => {
  it("replaces keyword and keeps numbers", () => {
    const body = interpolate({ key: "{{keyword}}", type: 7 }, { keyword: "改革" });
    expect(body).toEqual({ key: "改革", type: 7 });
  });
});

describe("train yaml", () => {
  it("parses and patches knobs", () => {
    const raw = "learning_rate: 1e-4\nlora_rank: 8\n";
    const knobs = parseTrainYaml(raw);
    expect(knobs.lora_rank).toBe(8);
    const next = patchTrainYaml(raw, { lora_rank: 16 });
    expect(next).toContain("lora_rank: 16");
  });
});

describe("cleanSampleCount", () => {
  it("adds keep rows so they are about the requested share", () => {
    expect(cleanSampleCount(90, 0.1)).toBe(10);
    expect(cleanSampleCount(0, 0.1)).toBe(0);
    expect(cleanSampleCount(10, 0)).toBe(0);
  });
});

describe("countJsonl", () => {
  it("returns 0 when missing", () => {
    expect(countJsonl(path.join(os.tmpdir(), "mt-missing.jsonl"))).toBe(0);
  });
});

describe("isRecord", () => {
  it("rejects arrays and null", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord({ a: 1 })).toBe(true);
  });
});

describe("ExclusiveJob", () => {
  it("rejects a second acquire until release", () => {
    const job = new ExclusiveJob();
    job.acquire("train");
    expect(job.busy).toBe(true);
    expect(() => job.acquire("generate")).toThrow(/任务进行中/);
    job.release("train");
    expect(job.busy).toBe(false);
    job.acquire("generate");
    expect(job.current).toBe("generate");
  });
});

describe("collectSentences", () => {
  it("skips normalized sentences already in the train set", () => {
    const term = "习近平总书记";
    const trainSent = "今天习近平总书记出席重要会议并发表讲话。";
    const evalSent = "明天习近平总书记将在北京考察调研工作。";
    const docs = [
      { source: "t", doc_id: "1", title: "", url: "", text: trainSent, extra: {} },
      { source: "t", doc_id: "2", title: "", url: "", text: evalSent, extra: {} },
    ];
    const hits = collectSentences(docs, term, 16, 220, new Set([normalizeSentence(trainSent)]));
    expect(hits.map((h) => h.sent)).toEqual([evalSent]);
  });
});

describe("train artifacts", () => {
  it("writes dataset_info and yaml", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-train-"));
    const trainFile = path.join(dir, "sft", "train.jsonl");
    fs.mkdirSync(path.dirname(trainFile), { recursive: true });
    fs.writeFileSync(trainFile, "{}\n", "utf8");
    const lf = path.join(dir, "lf");
    writeDatasetInfo(lf, trainFile);
    const info = JSON.parse(fs.readFileSync(path.join(lf, "dataset_info.json"), "utf8")) as {
      term_sft: { file_name: string };
    };
    expect(info.term_sft.file_name).toContain("train.jsonl");
    const yaml = path.join(dir, "train_sft.yaml");
    ensureTrainYaml(yaml, { lora_rank: 16 });
    expect(fs.readFileSync(yaml, "utf8")).toContain("lora_rank: 16");
  });

  it("refuses to start when the train jsonl is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-notrain-"));
    fs.writeFileSync(
      path.join(dir, "model-training.config.json"),
      `${JSON.stringify({ outDir: "./outputs", dict: "./dict.jsonl", sources: [] })}\n`,
      "utf8",
    );
    const cfg = await loadUserConfig({ command: "train", cwd: dir });
    await expect(startTrainFromConfig(cfg)).rejects.toThrow(/没有训练集/);
    expect(fs.existsSync(path.join(dir, "outputs", "llamafactory", "train_sft.yaml"))).toBe(false);
  });
});

describe("generate-eval", () => {
  it("does not copy train sentences into eval", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-eval-"));
    const term = "习近平总书记";
    const trainSent = "今天习近平总书记出席重要会议并发表讲话。";
    const evalSent = "明天习近平总书记将在北京考察调研工作。";
    fs.writeFileSync(
      path.join(dir, "dict.jsonl"),
      `${JSON.stringify({ wrong: "习总书记", correct: term })}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "corpus.jsonl"),
      `${JSON.stringify({ id: "1", text: trainSent })}\n${JSON.stringify({ id: "2", text: evalSent })}\n`,
      "utf8",
    );
    fs.mkdirSync(path.join(dir, "outputs", "sft"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "outputs", "sft", "train.jsonl"),
      `${JSON.stringify({
        instruction: "x",
        input: trainSent.replace(term, "习总书记"),
        output: trainSent,
        wrong: "习总书记",
        correct: term,
      })}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "model-training.config.json"),
      `${JSON.stringify({
        outDir: "./outputs",
        dict: "./dict.jsonl",
        sentence: { minLen: 16, maxLen: 220 },
        sources: [{ name: "local", type: "local_jsonl", options: { path: "./corpus.jsonl", limit: 20 } }],
      })}\n`,
      "utf8",
    );
    const cfg = await loadUserConfig({ command: "generate-eval", cwd: dir });
    const result = await generateEval(cfg);
    expect(result.written).toBe(1);
    const rows = readJsonl<{ output: string }>(cfg.paths.eval);
    expect(rows[0]?.output).toBe(evalSent);
    expect(leaksIntoTrain(rows.map((r) => r.output), [trainSent])).toEqual([]);
  });
});

describe("findRepoRoot", () => {
  it("walks up to pnpm-workspace.yaml", () => {
    const root = findRepoRoot(path.join(process.cwd(), "packages", "core", "src"));
    expect(fs.existsSync(path.join(root, "pnpm-workspace.yaml"))).toBe(true);
  });
});

describe("sourceDisplay", () => {
  it("uses 人民网检索 copy for people_search", () => {
    const shown = sourceDisplay({ name: "people_search" });
    expect(shown.title).toBe("人民网检索");
    expect(shown.description).toContain("cpc.people.com.cn");
  });
});

describe("normalizeSources", () => {
  it("fills display fields and keeps the config name", () => {
    const sources = normalizeSources([
      { name: "people_search", type: "http", options: { url: "http://example.test/s" } },
    ]);
    expect(sources[0]?.name).toBe("people_search");
    expect(sources[0]?.title).toBe("人民网检索");
    expect(sources[0]?.description).toContain("精确匹配");
  });
});

describe("selectSources", () => {
  it("filters by name among enabled sources", () => {
    const sources = normalizeSources([
      { name: "a", type: "http", options: { url: "http://a.test" } },
      { name: "b", type: "http", enabled: false, options: { url: "http://b.test" } },
    ]);
    const cfg = { sources } as unknown as import("../types.js").ResolvedConfig;
    expect(selectSources(cfg).map((s) => s.name)).toEqual(["a"]);
    expect(selectSources(cfg, "a")[0]?.name).toBe("a");
    expect(() => selectSources(cfg, "b")).toThrow(/找不到源/);
  });
});

describe("sharegpt format", () => {
  it("builds sharegpt turns", () => {
    const row = toShareGpt({
      instruction: "sys",
      input: "bad",
      output: "good",
      id: "1",
    });
    expect(row.conversations.map((t) => t.from)).toEqual(["human", "gpt"]);
    expect(wantsShareGpt(["messages", "sharegpt"])).toBe(true);
  });
});

describe("jsonl helpers", () => {
  it("reads json arrays and counts lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-jsonl-"));
    const jsonl = path.join(dir, "a.jsonl");
    fs.writeFileSync(jsonl, '{"a":1}\n{"a":2}\n', "utf8");
    expect(countJsonl(jsonl)).toBe(2);
    const json = path.join(dir, "b.json");
    fs.writeFileSync(json, JSON.stringify([{ x: 1 }, { x: 2 }]), "utf8");
    expect(readJsonOrJsonl(json)).toHaveLength(2);
  });
});


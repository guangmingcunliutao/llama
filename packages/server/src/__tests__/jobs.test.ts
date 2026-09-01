import { describe, expect, it } from "vitest";
import { createJobDispatcher } from "../jobs/dispatcher.js";
import type { JobCommand, JobHub } from "../jobs/types.js";
import type { AppContext } from "../appContext.js";
import { persistGeneratePatch } from "../appContext.js";
import { detectQuantSource } from "../datasets.js";
import { listProviders } from "../routes/providers.js";
import { shouldServeSpaIndex } from "../webStatic.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function fakeApp(root: string): AppContext {
  const file = path.join(root, "model-training.config.json");
  return {
    dataRoot: () => root,
    configPath: () => file,
    readConfigFile: () => JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>,
    writeConfigFile: (body) => fs.writeFileSync(file, `${JSON.stringify(body)}\n`, "utf8"),
  };
}

function fakeHub(busy = false): JobHub & { started: string[] } {
  const started: string[] = [];
  return {
    started,
    snapshot: () => ({
      ok: true,
      job: busy ? "generate" : null,
      busy,
      logs: [],
      lastCode: null,
      error: null,
    }),
    start(name) {
      if (busy) throw new Error("任务进行中: generate");
      started.push(name);
    },
    cancel() {},
  };
}

describe("createJobDispatcher", () => {
  const app = fakeApp(os.tmpdir());

  it("returns 404 for unknown jobs", async () => {
    const dispatcher = createJobDispatcher(app, fakeHub(), []);
    const result = await dispatcher.dispatch("nope", {});
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/未知任务/);
  });

  it("returns 400 when validate fails and does not start", async () => {
    const command: JobCommand = {
      name: "generate",
      async validate() {
        return "还没有词对字典";
      },
      async execute() {},
    };
    const hub = fakeHub();
    const dispatcher = createJobDispatcher(app, hub, [command]);
    const result = await dispatcher.dispatch("generate", {});
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("还没有词对字典");
    expect(hub.started).toEqual([]);
  });

  it("starts the matching command on success", async () => {
    const command: JobCommand = {
      name: "infer",
      async validate() {
        return null;
      },
      async execute() {},
    };
    const hub = fakeHub();
    const dispatcher = createJobDispatcher(app, hub, [command]);
    const result = await dispatcher.dispatch("infer", { backend: "rule" });
    expect(result.status).toBe(200);
    expect(hub.started).toEqual(["infer"]);
  });

  it("returns 409 when the hub is busy", async () => {
    const command: JobCommand = {
      name: "train",
      async validate() {
        return null;
      },
      async execute() {},
    };
    const dispatcher = createJobDispatcher(app, fakeHub(true), [command]);
    const result = await dispatcher.dispatch("train", {});
    expect(result.status).toBe(409);
  });
});

describe("persistGeneratePatch", () => {
  it("stores percent cleanRatio as a fraction", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-cfg-"));
    const ctx = fakeApp(dir);
    ctx.writeConfigFile({ instruction: "x" });
    persistGeneratePatch(ctx, { cleanRatio: 10, pairsPerTerm: 4, maxPages: 2 });
    const next = ctx.readConfigFile();
    expect(next.cleanRatio).toBe(0.1);
    expect(next.pairsPerTerm).toBe(4);
    expect(next.maxPages).toBe(2);
  });
});

describe("detectQuantSource", () => {
  it("classifies missing, file, and directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-q-"));
    const missing = detectQuantSource(path.join(dir, "nope.gguf"));
    expect(missing.exists).toBe(false);
    expect(missing.kind).toBe("missing");
    const gguf = path.join(dir, "m.gguf");
    fs.writeFileSync(gguf, "x");
    expect(detectQuantSource(gguf).kind).toBe("gguf");
    expect(detectQuantSource(dir).kind).toBe("hf-dir");
  });
});

describe("listProviders", () => {
  it("maps people_search to 人民网检索", () => {
    const listed = listProviders({
      sources: [{ name: "people_search", type: "http", options: { url: "http://x" } }],
    });
    expect(listed[0]).toMatchObject({
      id: "people_search",
      name: "人民网检索",
    });
    expect(listed[0]?.description).toContain("cpc.people.com.cn");
  });
});

describe("shouldServeSpaIndex", () => {
  it("does not treat hashed assets as pages", () => {
    expect(shouldServeSpaIndex("/assets/index-abc.js")).toBe(false);
    expect(shouldServeSpaIndex("/favicon.svg")).toBe(false);
    expect(shouldServeSpaIndex("/data")).toBe(true);
    expect(shouldServeSpaIndex("/api/jobs")).toBe(false);
  });
});

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RequestRateLimiter } from "../rateLimit.js";
import { HttpSearchSource } from "../sources/http.js";
import { probeHttp } from "../lfServices.js";

describe("HttpSearchSource cache", () => {
  it("skipCache ignores existing disk cache and hits the network", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-http-cache-"));
    const url = "http://127.0.0.1:1/search";
    const name = "people";
    const cacheKey = "词#1";
    const digest = crypto.createHash("md5").update(JSON.stringify({ keyword: cacheKey, url, name })).digest("hex");
    fs.writeFileSync(
      path.join(dir, `${digest}.json`),
      JSON.stringify([{ source: name, doc_id: "1", title: "t", url: "", text: "缓存正文足够长用来造句测试。" }]),
      "utf8",
    );
    const limiter = new RequestRateLimiter(60, 0);
    const cached = new HttpSearchSource(name, { url, cacheDir: dir, timeoutSec: 1 }, limiter);
    const fromCache = await cached.search("词");
    expect(fromCache[0]?.doc_id).toBe("1");
    const fresh = new HttpSearchSource(name, { url, cacheDir: dir, skipCache: true, timeoutSec: 1 }, limiter);
    await expect(fresh.search("词")).rejects.toThrow();
  });
});

describe("probeHttp", () => {
  it("returns false for a closed local port", async () => {
    expect(await probeHttp("http://127.0.0.1:1", 400)).toBe(false);
  });
});

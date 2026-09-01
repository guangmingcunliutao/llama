/**
 * 配置驱动的 HTTP 检索源。
 *
 * 不绑定任何具体网站：URL、方法、请求头、JSON 体、如何从响应里取 records，
 * 全部来自 {@link HttpSourceOptions}。可在配置里并列多条，指向不同接口。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { interpolate } from "../interpolate.js";
import type { RequestRateLimiter } from "../rateLimit.js";
import { htmlToText } from "../text.js";
import type { HttpSourceOptions, SearchSource, SourceDocument } from "../types.js";
import { asStringList, getPath, isRecord, pickField } from "../util.js";

function encodeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    let safe = true;
    for (let i = 0; i < value.length; i += 1) {
      if (value.charCodeAt(i) > 255) {
        safe = false;
        break;
      }
    }
    out[key] = safe ? value : encodeURI(value);
  }
  return out;
}

const DEFAULT_OK_CODES: Array<string | number> = [0, 200, "0", "200", ""];

function applyQuery(url: string, query: Record<string, unknown> | undefined): string {
  if (!query || Object.keys(query).length === 0) return url;
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
}

export class HttpSearchSource implements SearchSource {
  readonly remote = true;

  constructor(
    readonly name: string,
    readonly options: HttpSourceOptions,
    private readonly limiter: RequestRateLimiter,
  ) {
    if (!options.url) {
      throw new Error(`HTTP 源 ${name} 缺少 options.url`);
    }
  }

  async search(keyword: string): Promise<SourceDocument[]> {
    const pages = Math.max(1, Number(this.options.maxPages ?? 1));
    const merged: SourceDocument[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= pages; page += 1) {
      const docs = await this.searchPage(keyword, page);
      for (const doc of docs) {
        const key = doc.doc_id || doc.url || doc.text.slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(doc);
      }
    }
    return merged;
  }

  private async searchPage(keyword: string, page: number): Promise<SourceDocument[]> {
    const cacheKey = `${keyword}#${page}`;
    const cached = this.readCache(cacheKey);
    if (cached) return cached;

    await this.limiter.acquire(`source=${this.name} keyword=${keyword} page=${page}`);

    const vars = { keyword, keyword_enc: encodeURIComponent(keyword), page: String(page) };
    const method = (this.options.method ?? "POST").toUpperCase() as "GET" | "POST";
    const url = applyQuery(
      interpolate(this.options.url, vars),
      interpolate(this.options.query ?? {}, vars),
    );
    const headers = encodeHeaders(interpolate(this.options.headers ?? {}, vars));
    const timeoutMs = Number(this.options.timeoutSec ?? 25) * 1000;
    const body = interpolate({ ...(this.options.body ?? {}), page }, vars);

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (method === "POST") {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);
    if (!res.ok) {
      throw new Error(`${this.name} HTTP ${res.status}`);
    }

    const raw: unknown = await res.json();
    this.assertBusinessCode(raw);

    const records = this.readRecords(raw);
    const docs: SourceDocument[] = [];
    for (const item of records) {
      if (!isRecord(item)) continue;
      const html = pickField(item, asStringList(this.options.fields?.html, ["contentOriginal", "content"]));
      const text = htmlToText(html);
      if (!text) continue;
      docs.push({
        source: this.name,
        doc_id: pickField(item, asStringList(this.options.fields?.id, ["id", "contentId", "url"])),
        title: htmlToText(pickField(item, asStringList(this.options.fields?.title, ["title"]))),
        url: pickField(item, asStringList(this.options.fields?.url, ["url"])),
        text,
        extra: {
          origin_name: pickField(item, ["originName", "origin_name"]),
          domain: pickField(item, ["domain"]),
          page: String(page),
        },
      });
    }
    this.writeCache(cacheKey, docs);
    return docs;
  }

  private assertBusinessCode(raw: unknown): void {
    const codePath = this.options.codePath;
    if (!codePath) return;
    const code = getPath(raw, codePath);
    const ok = this.options.okCodes ?? DEFAULT_OK_CODES;
    if (!ok.includes(code as string | number) && !ok.includes(String(code))) {
      throw new Error(`${this.name} 返回异常 ${codePath}=${String(code)}`);
    }
  }

  private readRecords(raw: unknown): unknown[] {
    const found = getPath(raw, this.options.recordsPath ?? "data.records");
    return Array.isArray(found) ? found : [];
  }

  private cacheFile(keyword: string): string | null {
    if (!this.options.cacheDir) return null;
    const digest = crypto
      .createHash("md5")
      .update(JSON.stringify({ keyword, url: this.options.url, name: this.name }))
      .digest("hex");
    return path.join(this.options.cacheDir, `${digest}.json`);
  }

  private readCache(keyword: string): SourceDocument[] | null {
    const file = this.cacheFile(keyword);
    if (!file || !fs.existsSync(file)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as SourceDocument[]) : null;
  }

  private writeCache(keyword: string, docs: SourceDocument[]): void {
    const file = this.cacheFile(keyword);
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(docs), "utf8");
  }
}

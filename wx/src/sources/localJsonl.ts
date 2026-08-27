/**
 * 本地 jsonl 语料源。每行 JSON，正文取 text 或 content。
 * 首次 search 时读入内存，之后按关键词做包含匹配。不走远程频率限制。
 */
import fs from "node:fs";
import readline from "node:readline";
import { isRecord } from "../util.js";
import type { LocalJsonlSourceOptions, SearchSource, SourceDocument } from "../types.js";

export class LocalJsonlSource implements SearchSource {
  readonly remote = false;
  private docs: SourceDocument[] | null = null;

  constructor(
    readonly name: string,
    readonly options: LocalJsonlSourceOptions,
  ) {}

  async search(keyword: string): Promise<SourceDocument[]> {
    const docs = await this.load();
    const limit = Number(this.options.limit ?? 10);
    const hits: SourceDocument[] = [];
    for (const doc of docs) {
      if (keyword && doc.text.includes(keyword)) {
        hits.push(doc);
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  private async load(): Promise<SourceDocument[]> {
    if (this.docs) return this.docs;
    const file = this.options.path;
    if (!file || !fs.existsSync(file)) {
      throw new Error(`local_jsonl 语料不存在: ${file}`);
    }
    const docs: SourceDocument[] = [];
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const obj: unknown = JSON.parse(line);
      if (!isRecord(obj)) continue;
      const text = String(obj.text ?? obj.content ?? "");
      if (!text) continue;
      docs.push({
        source: this.name,
        doc_id: String(obj.id ?? obj.doc_id ?? ""),
        title: String(obj.title ?? ""),
        url: String(obj.url ?? ""),
        text,
        extra: {},
      });
    }
    this.docs = docs;
    return docs;
  }
}

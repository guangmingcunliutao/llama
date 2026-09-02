/** 正文清洗、按句号切句、过滤页脚/链接类噪音。 */
import { JobCancelledError } from "./abort.js";

const SENT_CUT = /(?<=[。！？；])/;
const NOISE =
  /新华社记者|本报记者|摄\s*$|责编：|二维码|请登录|讲话数据库|点击进入|点击查看|扫描关注|责任编辑|网络数据库/;

export function htmlToText(html = ""): string {
  let text = String(html);
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  text = text.replace(/\u00a0/g, " ").replace(/\u3000/g, " ");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export function splitSentences(text: string): string[] {
  const cleaned = htmlToText(text)
    .replace(/[ \t]+/g, "")
    .replace(/\n+/g, "\n")
    .trim();
  if (!cleaned) return [];
  const chunks: string[] = [];
  for (const block of cleaned.split("\n")) {
    const line = block.trim();
    if (!line) continue;
    const parts = line
      .split(SENT_CUT)
      .map((item) => item.trim())
      .filter(Boolean);
    chunks.push(...(parts.length ? parts : [line]));
  }
  return chunks;
}

/** 句子须含目标词、长度合适，且不像记者署名、责编、二维码等页脚。 */
export function goodSentence(sent: string, term: string, minLen = 16, maxLen = 220): boolean {
  if (!sent.includes(term)) return false;
  if (sent.length < minLen || sent.length > maxLen) return false;
  if (NOISE.test(sent)) return false;
  if (sent.includes("http") || sent.includes("www.")) return false;
  return true;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new JobCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new JobCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

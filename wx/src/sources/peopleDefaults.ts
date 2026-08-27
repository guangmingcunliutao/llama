/**
 * 人民网检索的默认 HTTP 配置，仅用于：
 * 1. 模板里给一个可复制的完整例子（与此保持同结构）
 * 2. 旧配置 `name: "people_search"` 且未写 `type` 时的兼容展开
 *
 * 新配置请在 termcorr.config.js 里直接写 `type: "http"` 与完整 options，
 * 不要依赖这份默认值去「猜」接口。
 */
import type { HttpSourceOptions } from "../types.js";

export const PEOPLE_SEARCH_HTTP: HttpSourceOptions = {
  url: "http://search.people.cn/search-platform/front/search",
  method: "POST",
  timeoutSec: 25,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=UTF-8",
    Origin: "http://search.people.cn",
    Referer: "http://search.people.cn/getNewsResult/?channel=cpc&x=10&y=11&keyword={{keyword}}",
  },
  body: {
    key: "{{keyword}}",
    page: 1,
    limit: 10,
    hasTitle: true,
    hasContent: true,
    isFuzzy: false,
    type: 7,
    domain: "cpc.people.com.cn",
    sources: null,
    sortType: 2,
    startTime: 0,
    endTime: 0,
  },
  recordsPath: "data.records",
  codePath: "code",
  okCodes: [0, 200, "0", "200", ""],
  fields: {
    html: ["contentOriginal", "content"],
    title: ["title"],
    url: ["url"],
    id: ["id", "contentId", "url"],
  },
};

/**
 * 把旧版扁平 options（channel / domain / type / limit …）合并进 HTTP 配置。
 */
export function applyLegacyPeopleOptions(
  base: HttpSourceOptions,
  legacy: Record<string, unknown>,
): HttpSourceOptions {
  const body: Record<string, unknown> = { ...(base.body ?? {}) };
  if (legacy.limit != null) body.limit = Number(legacy.limit);
  if (legacy.page != null) body.page = Number(legacy.page);
  if (legacy.domain != null) body.domain = legacy.domain;
  if (legacy.type != null) body.type = Number(legacy.type);
  if (legacy.is_fuzzy != null) body.isFuzzy = Boolean(legacy.is_fuzzy);
  if (legacy.has_content != null) body.hasContent = Boolean(legacy.has_content);
  if (legacy.has_title != null) body.hasTitle = Boolean(legacy.has_title);
  if (legacy.sort_type != null) body.sortType = Number(legacy.sort_type);
  if (legacy.start_time != null) body.startTime = Number(legacy.start_time);
  if (legacy.end_time != null) body.endTime = Number(legacy.end_time);
  if (legacy.sources !== undefined) body.sources = legacy.sources;

  const channel = String(legacy.channel ?? "cpc");
  const headers: Record<string, string> = { ...(base.headers ?? {}) };
  if (typeof legacy.user_agent === "string" && legacy.user_agent) {
    headers["User-Agent"] = legacy.user_agent;
  }
  headers.Referer = `http://search.people.cn/getNewsResult/?channel=${channel}&x=10&y=11&keyword={{keyword}}`;

  return {
    ...base,
    body,
    headers,
    timeoutSec: legacy.timeout != null ? Number(legacy.timeout) : base.timeoutSec,
  };
}

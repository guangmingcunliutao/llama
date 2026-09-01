/**
 * 检索源在界面上的标题与说明。
 * `name` 仍是配置主键（生成、缓存目录），不要把展示名写进检索协议。
 */
import { PEOPLE_SEARCH_DISPLAY } from "./peopleDefaults.js";

export function sourceDisplay(item: {
  name: string;
  title?: string | null;
  description?: string | null;
}): { title: string; description: string } {
  const title = item.title?.trim();
  const description = item.description?.trim();
  if (item.name === "people_search") {
    return {
      title: title || PEOPLE_SEARCH_DISPLAY.title,
      description: description || PEOPLE_SEARCH_DISPLAY.description,
    };
  }
  return {
    title: title || item.name,
    description: description || "",
  };
}

/** 判断普通对象（不含数组、null）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 按 `a.b.c` 读取嵌套字段；路径为空则返回原对象。 */
export function getPath(obj: unknown, dotted: string | undefined): unknown {
  if (!dotted) return obj;
  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (!isRecord(cur) || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function asStringList(value: string | string[] | undefined, fallback: string[]): string[] {
  if (value == null) return fallback;
  return Array.isArray(value) ? value : [value];
}

/** 按字段名列表取第一个非空字符串；名里可含点号路径。 */
export function pickField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = key.includes(".") ? getPath(record, key) : record[key];
    if (value != null && String(value).trim()) return String(value);
  }
  return "";
}

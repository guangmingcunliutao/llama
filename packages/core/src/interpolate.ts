/**
 * 把配置里的 `{{keyword}}` 替换成实际检索词。
 * 只处理字符串；数字、布尔、null 原样保留，以便 JSON 体里的 type: 7 不被改掉。
 */
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

export function interpolate<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER, (_match, key: string) => vars[key] ?? "") as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, vars)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = interpolate(nested, vars);
    }
    return out as T;
  }
  return value;
}

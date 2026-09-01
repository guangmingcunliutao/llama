/**
 * HTTP 业务结果的统一外壳。新增字段只往 `data` 里加，避免每个路由各写一套。
 */
export type ApiOk<T> = { ok: true; data: T };
export type ApiFail = { ok: false; error: string };

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}

export function fail(error: string): ApiFail {
  return { ok: false, error };
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function asFlag(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  return String(value);
}

export function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map((item) => String(item)).filter(Boolean);
  return out.length ? out : undefined;
}

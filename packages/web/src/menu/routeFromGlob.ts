/**
 * 把 pages 目录下的文件路径转成路由。
 * 菜单只读各页的 menu 元数据，不要再手写 path。
 */
export function routeFromGlobKey(key: string): string {
  const cleaned = key.replaceAll("\\", "/");
  const marker = "/pages/";
  const idx = cleaned.lastIndexOf(marker);
  const file = idx >= 0 ? cleaned.slice(idx + marker.length) : cleaned.replace(/^\.\//, "");
  const rel = file.replace(/\.tsx?$/, "");
  if (!rel || rel === "index") return "/";
  return `/${rel.replace(/\/index$/, "")}`;
}

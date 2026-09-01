/**
 * SPA 回退只给页面路由。带后缀的静态资源缺失时应 404，
 * 否则浏览器会把 index.html 当成 JS 模块加载（MIME text/html）。
 */
export function shouldServeSpaIndex(url: string): boolean {
  const pathOnly = url.split("?")[0] ?? url;
  if (pathOnly.startsWith("/api")) return false;
  if (pathOnly.startsWith("/assets/")) return false;
  return !/\.(js|mjs|css|map|svg|png|ico|woff2?|ttf|json|html)$/i.test(pathOnly);
}

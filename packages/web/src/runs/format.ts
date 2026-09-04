function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 把 run.json 里的 UTC ISO 转成本地 `YYYY-MM-DD HH:mm:ss`，与实验 id 的本地时分秒一致。 */
export function formatRunTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

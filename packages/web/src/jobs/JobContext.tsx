/**
 * 把任务状态接到页面。后台静默执行；仅页签可见且有任务在跑时低频率轮询。
 */
import { App as AntdApp } from "antd";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { jobPollIntervalMs, shouldPollJobs } from "./poll";
import { focusJob } from "./focus";
import type { JobSnapshot, JobSlotSnapshot } from "./types";

export type { JobSnapshot, JobSlotSnapshot };
export { focusJob };

const EMPTY: JobSnapshot = {
  ok: true,
  job: null,
  running: [],
  busy: false,
  logs: [],
  lastCode: null,
  error: null,
  jobs: {},
};

type JobApi = {
  snapshot: JobSnapshot;
  job: JobSnapshot;
  isBusy: (name: string) => boolean;
  refresh: () => Promise<JobSnapshot>;
  start: (url: string, body?: unknown) => Promise<JobSnapshot>;
  cancel: (name?: string) => Promise<void>;
};

const Ctx = createContext<JobApi | null>(null);

async function parseJob(res: Response): Promise<JobSnapshot> {
  const body = (await res.json()) as JobSnapshot & { error?: string };
  const jobs = body.jobs ?? {};
  const running = Array.isArray(body.running)
    ? body.running
    : body.busy && body.job
      ? [body.job]
      : [];
  return {
    ok: body.ok !== false && res.ok,
    job: body.job ?? running[0] ?? null,
    running,
    busy: Boolean(body.busy) || running.length > 0,
    logs: body.logs ?? [],
    lastCode: body.lastCode ?? null,
    error: body.error ?? null,
    jobs,
  };
}

export function JobProvider({ children }: { children: ReactNode }) {
  const { message } = AntdApp.useApp();
  const [snapshot, setSnapshot] = useState<JobSnapshot>(EMPTY);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const next = await parseJob(res);
    setSnapshot(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onVis = (): void => {
      const nextHidden = document.hidden;
      setHidden(nextHidden);
      if (!nextHidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  useEffect(() => {
    if (!shouldPollJobs(snapshot.busy, hidden)) return undefined;
    const interval = jobPollIntervalMs(hidden);
    if (interval == null) return undefined;
    const timer = window.setInterval(() => {
      void refresh();
    }, interval);
    return () => window.clearInterval(timer);
  }, [snapshot.busy, hidden, refresh]);

  const start = useCallback(
    async (url: string, body?: unknown) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const next = await parseJob(res);
      if (!next.ok) {
        message.error(next.error || "任务未能启动");
        setSnapshot(next);
        return next;
      }
      return refresh();
    },
    [message, refresh],
  );

  const cancel = useCallback(
    async (name?: string) => {
      await fetch("/api/jobs/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(name ? { name } : {}),
      });
      await refresh();
    },
    [refresh],
  );

  const isBusy = useCallback((name: string) => Boolean(snapshot.jobs[name]?.busy), [snapshot.jobs]);

  const value = useMemo(
    () => ({ snapshot, job: snapshot, isBusy, refresh, start, cancel }),
    [snapshot, isBusy, refresh, start, cancel],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useJob(names?: string | string[]): JobApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useJob 必须在 JobProvider 内");
  const namesKey = Array.isArray(names) ? names.join("\0") : (names ?? "");
  const job = useMemo(
    () => focusJob(ctx.snapshot, namesKey ? namesKey.split("\0") : undefined),
    [ctx.snapshot, namesKey],
  );
  const cancel = useCallback(
    async (name?: string) => {
      const target = name ?? (job.busy ? job.job : undefined) ?? undefined;
      await ctx.cancel(typeof target === "string" && target ? target : undefined);
    },
    [ctx, job.busy, job.job],
  );
  return { ...ctx, job, cancel };
}

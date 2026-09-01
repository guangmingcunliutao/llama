/**
 * 把任务状态接到页面。任务进行中才轮询 /api/jobs。
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
import { shouldPollJobs } from "./poll";

export interface JobSnapshot {
  ok: boolean;
  job: string | null;
  busy: boolean;
  logs: string[];
  lastCode: number | null;
  error: string | null;
}

const EMPTY: JobSnapshot = {
  ok: true,
  job: null,
  busy: false,
  logs: [],
  lastCode: null,
  error: null,
};

type JobApi = {
  job: JobSnapshot;
  refresh: () => Promise<JobSnapshot>;
  start: (url: string, body?: unknown) => Promise<JobSnapshot>;
  cancel: () => Promise<void>;
};

const Ctx = createContext<JobApi | null>(null);

async function parseJob(res: Response): Promise<JobSnapshot> {
  const body = (await res.json()) as JobSnapshot & { error?: string };
  return {
    ok: body.ok !== false && res.ok,
    job: body.job ?? null,
    busy: Boolean(body.busy),
    logs: body.logs ?? [],
    lastCode: body.lastCode ?? null,
    error: body.error ?? null,
  };
}

export function JobProvider({ children }: { children: ReactNode }) {
  const { message } = AntdApp.useApp();
  const [job, setJob] = useState<JobSnapshot>(EMPTY);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const next = await parseJob(res);
    setJob(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!shouldPollJobs(job.busy)) return undefined;
    const timer = window.setInterval(() => {
      void refresh();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job.busy, refresh]);

  const start = useCallback(
    async (url: string, body?: unknown) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const next = await parseJob(res);
      setJob(next);
      if (!next.ok) {
        message.error(next.error || "任务未能启动");
      }
      return next;
    },
    [message],
  );

  const cancel = useCallback(async () => {
    await fetch("/api/jobs/cancel", { method: "POST" });
    await refresh();
  }, [refresh]);

  const value = useMemo(() => ({ job, refresh, start, cancel }), [job, refresh, start, cancel]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useJob(): JobApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useJob 必须在 JobProvider 内");
  return ctx;
}

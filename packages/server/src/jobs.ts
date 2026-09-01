import { ExclusiveJob } from "@model-training/core";

export interface JobSnapshot {
  ok: boolean;
  job: string | null;
  busy: boolean;
  logs: string[];
  lastCode: number | null;
  error: string | null;
}

export interface JobContext {
  signal: AbortSignal;
  onLog: (line: string) => void;
}

const MAX_LOGS = 2000;

export async function withCapturedLogs<T>(onLog: (line: string) => void, fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  const error = console.error;
  const write = (args: unknown[]): void => {
    const line = args
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join(" ");
    if (line.trim()) onLog(line);
  };
  console.log = (...args: unknown[]) => {
    write(args);
    log.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    write(args);
    error.apply(console, args);
  };
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

export function createJobHub() {
  const lock = new ExclusiveJob();
  const logs: string[] = [];
  let lastCode: number | null = null;
  let error: string | null = null;
  let controller: AbortController | null = null;

  function snapshot(): JobSnapshot {
    return {
      ok: true,
      job: lock.current,
      busy: lock.busy,
      logs: [...logs],
      lastCode,
      error,
    };
  }

  function onLog(line: string): void {
    logs.push(line);
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
  }

  function cancel(): void {
    controller?.abort();
  }

  function start(name: string, run: (ctx: JobContext) => Promise<void>): void {
    lock.acquire(name);
    logs.length = 0;
    error = null;
    lastCode = null;
    controller = new AbortController();
    const ctx: JobContext = { signal: controller.signal, onLog };
    void withCapturedLogs(onLog, () => run(ctx))
      .then(() => {
        lastCode = 0;
      })
      .catch((err: unknown) => {
        error = err instanceof Error ? err.message : String(err);
        lastCode = 1;
        onLog(`[error] ${error}`);
      })
      .finally(() => {
        lock.release(name);
        controller = null;
      });
  }

  return { snapshot, start, cancel };
}

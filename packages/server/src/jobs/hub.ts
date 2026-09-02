/**
 * 按任务名分槽：同名互斥，不同名可并行。
 * 日志用 AsyncLocalStorage 分流，避免并发时 console 劫持串台。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { ExclusiveJob, isJobCancelled } from "@model-training/core";

export interface JobSlotSnapshot {
  name: string;
  busy: boolean;
  logs: string[];
  lastCode: number | null;
  error: string | null;
}

export interface JobSnapshot {
  ok: boolean;
  job: string | null;
  running: string[];
  busy: boolean;
  logs: string[];
  lastCode: number | null;
  error: string | null;
  jobs: Record<string, JobSlotSnapshot>;
}

export interface JobContext {
  signal: AbortSignal;
  onLog: (line: string) => void;
}

const MAX_LOGS = 2000;
const jobLog = new AsyncLocalStorage<(line: string) => void>();
let consolePatched = false;

function lineFromArgs(args: unknown[]): string {
  return args
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .join(" ");
}

function patchConsoleOnce(): void {
  if (consolePatched) return;
  consolePatched = true;
  const log = console.log;
  const error = console.error;
  const write = (args: unknown[]): void => {
    const line = lineFromArgs(args);
    if (line.trim()) jobLog.getStore()?.(line);
  };
  console.log = (...args: unknown[]) => {
    write(args);
    log.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    write(args);
    error.apply(console, args);
  };
}

interface SlotState {
  busy: boolean;
  logs: string[];
  lastCode: number | null;
  error: string | null;
  controller: AbortController | null;
}

function emptySlot(name: string): JobSlotSnapshot {
  return { name, busy: false, logs: [], lastCode: null, error: null };
}

export function createJobHub() {
  const lock = new ExclusiveJob();
  const slots = new Map<string, SlotState>();
  let lastName: string | null = null;

  function ensure(name: string): SlotState {
    let slot = slots.get(name);
    if (!slot) {
      slot = { busy: false, logs: [], lastCode: null, error: null, controller: null };
      slots.set(name, slot);
    }
    return slot;
  }

  function slotView(name: string): JobSlotSnapshot {
    const slot = slots.get(name);
    if (!slot) return emptySlot(name);
    return {
      name,
      busy: slot.busy,
      logs: [...slot.logs],
      lastCode: slot.lastCode,
      error: slot.error,
    };
  }

  function snapshot(): JobSnapshot {
    const running = lock.running();
    const jobs: Record<string, JobSlotSnapshot> = {};
    for (const name of slots.keys()) {
      jobs[name] = slotView(name);
    }
    const primary = running[0] ?? lastName;
    const view = primary ? jobs[primary] : emptySlot("");
    return {
      ok: true,
      job: primary,
      running,
      busy: running.length > 0,
      logs: view.logs,
      lastCode: view.lastCode,
      error: view.error,
      jobs,
    };
  }

  function cancel(name?: string): void {
    if (name) {
      slots.get(name)?.controller?.abort();
      return;
    }
    for (const slot of slots.values()) {
      slot.controller?.abort();
    }
  }

  function start(name: string, run: (ctx: JobContext) => Promise<void>): void {
    patchConsoleOnce();
    lock.acquire(name);
    lastName = name;
    const slot = ensure(name);
    slot.logs.length = 0;
    slot.error = null;
    slot.lastCode = null;
    slot.busy = true;
    slot.controller = new AbortController();
    const onLog = (line: string): void => {
      slot.logs.push(line);
      if (slot.logs.length > MAX_LOGS) slot.logs.splice(0, slot.logs.length - MAX_LOGS);
    };
    const ctx: JobContext = { signal: slot.controller.signal, onLog };
    void jobLog
      .run(onLog, () => run(ctx))
      .then(() => {
        slot.lastCode = 0;
      })
      .catch((err: unknown) => {
        if (isJobCancelled(err) || slot.controller?.signal.aborted) {
          slot.lastCode = 130;
          slot.error = null;
          onLog("[cancelled] 已停止");
          return;
        }
        slot.error = err instanceof Error ? err.message : String(err);
        slot.lastCode = 1;
        onLog(`[error] ${slot.error}`);
      })
      .finally(() => {
        slot.busy = false;
        slot.controller = null;
        lock.release(name);
      });
  }

  return { snapshot, start, cancel };
}

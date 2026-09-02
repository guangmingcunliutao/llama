/** 长任务取消（生成限速等待、HTTP 请求、安装子进程）。 */
export class JobCancelledError extends Error {
  override readonly name = "AbortError";

  constructor(message = "已停止") {
    super(message);
  }
}

export function isJobCancelled(err: unknown): boolean {
  return (
    err instanceof JobCancelledError ||
    (err instanceof Error && (err.name === "AbortError" || err.message === "已停止"))
  );
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new JobCancelledError();
}

/** 把用户取消与超时合成一个 AbortSignal（不依赖 Node 20 的 AbortSignal.any）。 */
export function abortWithTimeout(timeoutMs: number, user?: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const abort = (): void => {
    if (!ctrl.signal.aborted) ctrl.abort();
  };
  if (user?.aborted) {
    abort();
    return ctrl.signal;
  }
  const timer = setTimeout(abort, timeoutMs);
  const onUser = (): void => {
    clearTimeout(timer);
    abort();
  };
  user?.addEventListener("abort", onUser, { once: true });
  ctrl.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      user?.removeEventListener("abort", onUser);
    },
    { once: true },
  );
  return ctrl.signal;
}

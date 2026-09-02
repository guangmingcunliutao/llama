import { throwIfAborted } from "./abort.js";
import { sleep } from "./text.js";

/**
 * 把远程请求压到「每分钟 N 次」的均匀间隔。
 *
 * 默认 5 次/分钟 ≈ 间隔 12 秒，再加一点抖动，避免像脚本一样打点过齐。
 * 只应包在真正发网络请求之前；缓存命中不要调用。
 */
export class RequestRateLimiter {
  private lastAt = 0;

  constructor(
    readonly requestsPerMinute: number,
    readonly jitterSec: number = 0,
  ) {
    if (!Number.isFinite(requestsPerMinute) || requestsPerMinute <= 0) {
      throw new Error("rate.requestsPerMinute 必须大于 0");
    }
  }

  /**
   * 等到满足频率后再返回。第一次调用立即放行。
   * @param label 打到日志里的说明，例如源名称和关键词
   */
  async acquire(label?: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const minInterval = 60_000 / this.requestsPerMinute;
    const jitter = this.jitterSec > 0 ? Math.random() * this.jitterSec * 1000 : 0;
    const earliest = this.lastAt === 0 ? Date.now() : this.lastAt + minInterval;
    const wait = earliest + jitter - Date.now();
    if (wait > 0) {
      const hint = label ? ` ${label}` : "";
      console.log(
        `[rate] 等待 ${(wait / 1000).toFixed(1)}s（${this.requestsPerMinute} 次/分钟）${hint}`,
      );
      await sleep(wait, signal);
    }
    throwIfAborted(signal);
    this.lastAt = Date.now();
  }
}

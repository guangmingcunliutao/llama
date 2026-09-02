/** 长任务在后台跑；页签可见时慢速拉状态，切走后停轮询。 */
export const JOB_POLL_VISIBLE_MS = 8000;

export function shouldPollJobs(busy: boolean, hidden = false): boolean {
  return busy && !hidden;
}

export function jobPollIntervalMs(hidden: boolean): number | null {
  if (hidden) return null;
  return JOB_POLL_VISIBLE_MS;
}

/** 任务进行中才轮询 /api/jobs，空闲或失败后停止。 */
export function shouldPollJobs(busy: boolean): boolean {
  return busy;
}

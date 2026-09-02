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

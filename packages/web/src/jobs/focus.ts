import type { JobSnapshot, JobSlotSnapshot } from "./types";

export type { JobSnapshot, JobSlotSnapshot };

function emptySlot(name: string): JobSlotSnapshot {
  return { name, busy: false, logs: [], lastCode: null, error: null };
}

export function focusJob(snapshot: JobSnapshot, names?: string | string[]): JobSnapshot {
  if (names == null) return snapshot;
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const running = list.filter((name) => snapshot.jobs[name]?.busy);
  const pick = running[0] ?? [...list].reverse().find((name) => snapshot.jobs[name]) ?? list[0];
  const slot = pick ? (snapshot.jobs[pick] ?? emptySlot(pick)) : emptySlot("");
  const error = running.length ? null : (list.map((name) => snapshot.jobs[name]?.error).find(Boolean) ?? null);
  return {
    ...snapshot,
    job: slot.busy ? slot.name : running[0] ?? (slot.name || null),
    running,
    busy: running.length > 0,
    logs: slot.logs,
    lastCode: slot.lastCode,
    error,
  };
}

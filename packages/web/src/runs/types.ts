export interface RunSummary {
  id: string;
  kind: "data" | "train" | "eval";
  status: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  mode: string;
  parentId: string | null;
  phase?: string;
  trainRows?: number;
  evalRows?: number;
  lastCheckpoint?: string | null;
  adapterReady?: boolean;
  canResume: boolean;
  resumeHint?: string;
  dataRunId?: string | null;
  trainRunId?: string | null;
}

export interface WorkspacePointer {
  dataRunId: string | null;
  trainRunId: string | null;
  evalRunId: string | null;
}

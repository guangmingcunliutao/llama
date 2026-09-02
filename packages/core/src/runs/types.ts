export type RunKind = "data" | "train" | "eval";
export type RunStatus = "pending" | "running" | "interrupted" | "failed" | "completed";
export type RunMode = "fresh" | "resume" | "continue";
export type DataPhase = "idle" | "generating_train" | "train_done" | "generating_eval" | "completed";

export interface WorkspacePointer {
  dataRunId: string | null;
  trainRunId: string | null;
  evalRunId: string | null;
}

export interface RunMeta {
  id: string;
  kind: RunKind;
  status: RunStatus;
  mode: RunMode;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  label: string;
  pid: number | null;
  error: string | null;
  exitCode: number | null;
  phase?: DataPhase;
  dataRunId?: string | null;
  dataFingerprint?: string | null;
  paramsFingerprint?: string | null;
  resumeFrom?: string | null;
  lastCheckpoint?: string | null;
  adapterReady?: boolean;
  trainRunId?: string | null;
  skippedLeak?: number;
}

export interface DataProgress {
  phase: DataPhase;
  termIndex: number;
  termTotal: number;
  currentCorrect: string;
  writtenError: number;
  writtenKeep: number;
  evalTermIndex: number;
  evalWritten: number;
  evalKeep: number;
  skippedLeak: number;
}

export interface DataParams {
  pairsPerTerm: number;
  limitTerms: number | null;
  cleanRatio: number;
  maxPages: number;
  instruction: string;
  sources: string[];
  formats: string[];
  minLen: number;
  maxLen: number;
}

export interface TrainParams {
  knobs: Record<string, string | number | boolean>;
  dataRunId: string;
  dataFingerprint: string;
  parentId: string | null;
}

export interface DataRunPaths {
  dir: string;
  run: string;
  params: string;
  progress: string;
  logs: string;
  train: string;
  trainSharegpt: string;
  evalDir: string;
  eval: string;
  evalSeen: string;
  evalUnseen: string;
  evalKeep: string;
  splitReport: string;
}

export interface TrainRunPaths {
  dir: string;
  run: string;
  params: string;
  logs: string;
  yaml: string;
  lf: string;
  sftCopy: string;
  ckpt: string;
  quant: string;
}

export interface EvalRunPaths {
  dir: string;
  run: string;
  params: string;
  logs: string;
  lf: string;
  predictYaml: string;
  lfPredict: string;
  inferDir: string;
  pred: string;
  predSeen: string;
  predUnseen: string;
  predKeep: string;
  metrics: string;
  scored: string;
  analysis: string;
}

export interface RunSummary {
  id: string;
  kind: RunKind;
  status: RunStatus;
  label: string;
  createdAt: string;
  updatedAt: string;
  mode: RunMode;
  parentId: string | null;
  phase?: DataPhase;
  trainRows?: number;
  evalRows?: number;
  lastCheckpoint?: string | null;
  adapterReady?: boolean;
  canResume: boolean;
  resumeHint?: string;
  dataRunId?: string | null;
  trainRunId?: string | null;
}

import { useCallback, useEffect, useState } from "react";
import type { RunSummary, WorkspacePointer } from "./types";

export function useRuns(kind: "data" | "train" | "eval") {
  const [rows, setRows] = useState<RunSummary[]>([]);
  const [workspace, setWorkspace] = useState<WorkspacePointer | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/runs?kind=${kind}`);
    const body = (await res.json()) as {
      data?: { runs?: RunSummary[]; workspace?: WorkspacePointer };
    };
    setRows(body.data?.runs ?? []);
    if (body.data?.workspace) setWorkspace(body.data.workspace);
  }, [kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = useCallback(
    async (id: string) => {
      await fetch(`/api/runs/${kind}/${id}/select`, { method: "POST" });
      await refresh();
    },
    [kind, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await fetch(`/api/runs/${kind}/${id}`, { method: "DELETE" });
      await refresh();
    },
    [kind, refresh],
  );

  const selectedId =
    kind === "data" ? workspace?.dataRunId : kind === "train" ? workspace?.trainRunId : workspace?.evalRunId;
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  return { rows, workspace, selected, selectedId: selectedId ?? null, refresh, select, remove };
}

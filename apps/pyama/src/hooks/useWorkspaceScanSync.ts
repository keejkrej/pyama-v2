import { useStore } from "zustand";

import type { DataPort, Source } from "@/lib/contracts";
import { useSavedStateQuery, useScanSourceQuery } from "@/lib/query";

import { appStore } from "@/lib/store";
import { useSyncSavedStateQuery, useSyncScanSourceQuery } from "./syncQueryToStore";

/** Owns scan + saved-state TanStack queries and bridges them into {@link appStore}. */
export function useWorkspaceScanSync(
  backend: DataPort,
  workspacePath: string | null,
  source: Source | null,
) {
  const selectedPos = useStore(appStore, (s) => s.selection?.pos ?? null);

  const scanSourceQuery = useScanSourceQuery(backend, source, {
    enabled: Boolean(source),
  });
  const savedStateQuery = useSavedStateQuery(backend, workspacePath, selectedPos, {
    enabled: selectedPos != null && Boolean(workspacePath),
  });

  useSyncScanSourceQuery(source, scanSourceQuery);
  useSyncSavedStateQuery(selectedPos, workspacePath, savedStateQuery);
}

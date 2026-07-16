import { useStore } from "zustand";

import type { HostApi, Source } from "@/lib/contracts";
import { useAlignStateQuery, useScanSourceQuery } from "@/lib/query";

import { appStore } from "@/lib/store";
import { useSyncAlignStateQuery, useSyncScanSourceQuery } from "./syncQueryToStore";

/** Owns scan + saved-state TanStack queries and bridges them into {@link appStore}. */
export function useWorkspaceScanSync(
  api: HostApi,
  workspacePath: string | null,
  source: Source | null,
) {
  const selectedPos = useStore(appStore, (s) => s.selection?.pos ?? null);

  const scanSourceQuery = useScanSourceQuery(api, source, {
    enabled: Boolean(source),
  });
  const alignStateQuery = useAlignStateQuery(api, workspacePath, selectedPos, {
    enabled: selectedPos != null && Boolean(workspacePath),
  });

  useSyncScanSourceQuery(source, scanSourceQuery);
  useSyncAlignStateQuery(selectedPos, workspacePath, alignStateQuery);
}

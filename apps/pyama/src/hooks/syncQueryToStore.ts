import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";

import type { AlignState, Source, WorkspaceScan } from "@/lib/contracts";
import { coerceSelection, createSelection } from "@/lib/core";
import { toErrorMessage } from "@/lib/errors";
import {
  applyAlignState,
  patchViewState,
} from "@/lib/store";
import { showErrorToast } from "@/lib/toast";

/** Bridges `useScanSourceQuery` into the app store. */
export function useSyncScanSourceQuery(
  source: Source | null,
  query: UseQueryResult<WorkspaceScan, Error>,
) {
  useEffect(() => {
    if (!source) return;

    if (query.isPending) {
      patchViewState({
        loading: true,
        error: null,
        frame: null,
        scan: null,
        selection: null,
        contrastMode: "manual",
      });
      return;
    }

    if (query.isError) {
      patchViewState({ loading: false, error: toErrorMessage(query.error) });
      return;
    }

    if (query.data) {
      const scanData = query.data;
      const nextSelection = coerceSelection(scanData, createSelection(scanData));
      patchViewState({
        scan: scanData,
        selection: nextSelection,
        loading: false,
        error: null,
      });
    }
  }, [source, query.data, query.error, query.isError, query.isPending]);
}

/** Bridges `useAlignStateQuery` into `applyAlignState`; optional `onAfterApply` (e.g. Studio enables grid). */
export function useSyncAlignStateQuery(
  selectedPos: number | null,
  workspacePath: string | null | undefined,
  query: UseQueryResult<AlignState | null, Error>,
  onAfterApply?: () => void,
) {
  useEffect(() => {
    if (selectedPos == null) return;

    if (!workspacePath) {
      applyAlignState(selectedPos, null);
      return;
    }

    if (query.isError) {
      showErrorToast(toErrorMessage(query.error));
      return;
    }

    if (query.isSuccess) {
      applyAlignState(selectedPos, query.data);
      onAfterApply?.();
    }
  }, [onAfterApply, query.data, query.error, query.isError, query.isSuccess, selectedPos, workspacePath]);
}

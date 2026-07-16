import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";

import type { SavedState, Source, WorkspaceScan } from "@/lib/contracts";
import { coerceSelection, createSelection } from "@/lib/core";
import { toErrorMessage } from "@/lib/effects";
import { initialSelection } from "@/lib/selection";
import {
  applySavedState,
  patchViewState,
  setGrid,
  setSource,
  setTimeSliderIndex,
  setWorkspacePath,
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

/** Bridges `useSavedStateQuery` into `applySavedState`; optional `onAfterApply` (e.g. Studio enables grid). */
export function useSyncSavedStateQuery(
  selectedPos: number | null,
  workspacePath: string | null | undefined,
  query: UseQueryResult<SavedState | null, Error>,
  onAfterApply?: () => void,
) {
  useEffect(() => {
    if (selectedPos == null) return;

    if (!workspacePath) {
      applySavedState(selectedPos, null);
      return;
    }

    if (query.isError) {
      showErrorToast(toErrorMessage(query.error));
      return;
    }

    if (query.isSuccess) {
      applySavedState(selectedPos, query.data);
      onAfterApply?.();
    }
  }, [onAfterApply, query.data, query.error, query.isError, query.isSuccess, selectedPos, workspacePath]);
}

/** Workspace scan query plus workspace/source wiring and time slider. */
export function useSyncScanSourceQueryToStore(
  backendReady: boolean,
  workspaceTrim: string,
  sourceInferred: Source | null,
  query: UseQueryResult<WorkspaceScan, Error>,
) {
  useEffect(() => {
    if (!backendReady || !workspaceTrim || !sourceInferred) return;

    setWorkspacePath(workspaceTrim);
    setSource(sourceInferred);

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
      const scanned = query.data;
      const sel = coerceSelection(scanned, initialSelection(scanned));
      patchViewState({ scan: scanned, selection: sel, loading: false, error: null });
      setGrid((g) => ({ ...g, enabled: true }));
      const ti = scanned.times.indexOf(sel.time);
      setTimeSliderIndex(ti >= 0 ? ti : 0);
    }
  }, [
    backendReady,
    workspaceTrim,
    sourceInferred,
    query.data,
    query.error,
    query.isError,
    query.isPending,
  ]);
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type {
  AutoExcludePreviewRequest,
  HostApi,
  Source,
} from "@/lib/contracts";
import {
  buildBboxCsv,
  collectEdgeCells,
  countVisibleCells,
  enumerateVisibleGridCells,
  toggleExcludedCells as toggleExcludedCellCoords,
  type GridCellCoord,
} from "@/lib/core";
import { AutoExcludeDialog } from "@/components/AutoExcludeDialog";
import {
  autoExcludeCount,
  clampThresholdToDomain,
  scoreDomainForPreview,
} from "@/components/AutoExclude";
import CanvasSurface from "@/components/CanvasSurface";
import { FrameNavigation } from "@/components/FrameNavigation";
import { GridSidebar } from "@/components/GridSidebar";
import { IntensitySidebar } from "@/components/IntensitySidebar";
import Navbar from "@/components/Navbar";
import { SelectionSidebar } from "@/components/SelectionSidebar";
import {
  SidebarField,
  SidebarSection,
  SidebarValue,
} from "@/components/sidebar";
import { Button } from "@/components/ui";
import { useGridCanvasInteraction } from "@/hooks/useGridCanvasInteraction";
import { useSourceFrameLoad } from "@/hooks/useSourceFrameLoad";
import { useWorkspaceScanSync } from "@/hooks/useWorkspaceScanSync";
import { toErrorMessage } from "@/lib/errors";
import { FrameCache } from "@/lib/frameCache";
import {
  useAutoExcludePreviewQuery,
  useSaveBboxMutation,
} from "@/lib/query";
import {
  excludeCells,
  resetExcludedCells,
  setSaving,
  setSelectionMode,
  appStore,
} from "@/lib/store";
import { showErrorToast, showSuccessToast } from "@/lib/toast";

export interface WorkspaceProps {
  workspacePath: string | null;
  source: Source | null;
  api: HostApi;
  onPickWorkspace: () => void | Promise<void>;
  onOpenNd2: () => void | Promise<void>;
  onOpenCzi: () => void | Promise<void>;
  onClearSource: () => void;
}

function gridCellCoordKey(cell: GridCellCoord): string {
  return `${cell.i}:${cell.j}`;
}

export default function Workspace({
  workspacePath,
  source,
  api,
  onPickWorkspace,
  onOpenNd2,
  onOpenCzi,
  onClearSource,
}: WorkspaceProps) {
  const frameCacheRef = useRef(new FrameCache());
  const [autoExcludeOpen, setAutoExcludeOpen] = useState(false);
  const [autoExcludeThreshold, setAutoExcludeThreshold] = useState<number>(0);
  const lastErrorToastRef = useRef<string | null>(null);
  const {
    scan,
    selection,
    grid,
    frame,
    loading,
    error,
    contrastMin,
    contrastMax,
    contrastMode,
    contrastReloadToken,
    selectionMode,
    excludedCellsByPosition,
    saving,
  } = useStore(
    appStore,
    useShallow((state) => ({
      scan: state.scan,
      selection: state.selection,
      grid: state.grid,
      frame: state.frame,
      loading: state.loading,
      error: state.error,
      contrastMin: state.contrastMin,
      contrastMax: state.contrastMax,
      contrastMode: state.contrastMode,
      contrastReloadToken: state.contrastReloadToken,
      selectionMode: state.selectionMode,
      excludedCellsByPosition: state.excludedCellsByPosition,
      saving: state.saving,
    })),
  );

  const saveBboxMutation = useSaveBboxMutation(api);

  useWorkspaceScanSync(api, workspacePath, source);

  const contrastRequestKey =
    contrastMode === "auto" ? `auto:${contrastReloadToken}` : `${contrastMin}:${contrastMax}`;

  useSourceFrameLoad({
    api,
    source,
    selection,
    contrastMode,
    contrastMin,
    contrastMax,
    contrastRequestKey,
    frameCacheRef,
  });

  const {
    previewGrid,
    selectionPreviewCells,
    canvasCursor,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerEnd,
    handleCanvasWheel,
  } = useGridCanvasInteraction({
    frame,
    grid,
    selection,
    selectionMode,
  });

  const hasScan = !!scan && scan.positions.length > 0;
  const controlsDisabled = !hasScan || !selection;

  useEffect(() => {
    if (!grid.enabled || !frame) {
      setSelectionMode(false);
    }
  }, [frame, grid.enabled]);

  useEffect(() => {
    if (!error) {
      lastErrorToastRef.current = null;
      return;
    }
    if (lastErrorToastRef.current === error) return;
    lastErrorToastRef.current = error;
    showErrorToast(error);
  }, [error]);

  const currentPositionExcludedCells = useMemo(
    () => (selection ? excludedCellsByPosition[selection.pos] ?? [] : []),
    [excludedCellsByPosition, selection],
  );
  const activeExcludedCellKeys = useMemo(
    () => new Set(currentPositionExcludedCells.map(gridCellCoordKey)),
    [currentPositionExcludedCells],
  );

  const autoExcludeRequest = useMemo((): AutoExcludePreviewRequest | null => {
    if (!autoExcludeOpen || !source || !selection || !frame || !grid.enabled) return null;
    const cells = enumerateVisibleGridCells(frame, grid).filter(
      (cell) => !activeExcludedCellKeys.has(gridCellCoordKey(cell)),
    );
    return { source, selection, cells };
  }, [activeExcludedCellKeys, autoExcludeOpen, frame, grid, selection, source]);

  const autoExcludePreviewQuery = useAutoExcludePreviewQuery(api, autoExcludeRequest);
  const autoExcludePreview = autoExcludePreviewQuery.data ?? null;
  const autoExcludeLoading = Boolean(autoExcludeRequest) && autoExcludePreviewQuery.isPending;
  const autoExcludeError = autoExcludePreviewQuery.isError
    ? toErrorMessage(autoExcludePreviewQuery.error)
    : null;

  useEffect(() => {
    if (!autoExcludePreview) return;
    setAutoExcludeThreshold(
      clampThresholdToDomain(autoExcludePreview.threshold, scoreDomainForPreview(autoExcludePreview)),
    );
  }, [autoExcludePreview]);

  const renderedExcludedCells = useMemo(
    () =>
      selectionPreviewCells
        ? toggleExcludedCellCoords(currentPositionExcludedCells, selectionPreviewCells)
        : currentPositionExcludedCells,
    [currentPositionExcludedCells, selectionPreviewCells],
  );
  const visibleCells = useMemo(
    () => (frame ? enumerateVisibleGridCells(frame, grid) : []),
    [frame, grid],
  );
  const visibleCellCounts = useMemo(
    () => (frame ? countVisibleCells(frame, grid, currentPositionExcludedCells) : { included: 0, excluded: 0 }),
    [currentPositionExcludedCells, frame, grid],
  );
  const excludedVisibleCount = visibleCellCounts.excluded;
  const includedVisibleCount = visibleCellCounts.included;
  const autoExcludeSelectionCount = useMemo(
    () => autoExcludeCount(autoExcludePreview?.cellScores ?? [], autoExcludeThreshold),
    [autoExcludePreview, autoExcludeThreshold],
  );

  useEffect(() => {
    if (!autoExcludeOpen) return;
    if (!source || !selection || !frame || !grid.enabled) {
      setAutoExcludeOpen(false);
    }
  }, [autoExcludeOpen, frame, grid.enabled, selection, source]);

  const emptyText = useMemo(() => {
    if (!workspacePath) return "Select a workspace folder to save bbox CSVs";
    if (!source) return "Select an ND2 or CZI file to load frames";
    if (scan && scan.positions.length === 0) {
      return source.kind === "nd2"
        ? "No frames found in ND2 file"
        : "No frames found in CZI file";
    }
    return "No frame loaded";
  }, [scan, source, workspacePath]);

  const handleSave = useCallback(async () => {
    if (!workspacePath || !source || !selection || !frame) return;

    setSaving(true);
    try {
      const response = await saveBboxMutation.mutateAsync({
        workspacePath,
        source,
        pos: selection.pos,
        csv: buildBboxCsv(frame, grid, currentPositionExcludedCells),
        alignState: {
          grid,
          excludedCells: currentPositionExcludedCells,
        },
      });
      if (!response.ok) {
        showErrorToast(response.error ?? "Failed to save outputs");
      } else {
        showSuccessToast(`Saved Pos${selection.pos}`);
      }
    } catch (cause) {
      showErrorToast(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }, [currentPositionExcludedCells, frame, grid, saveBboxMutation, selection, source, workspacePath]);

  const handleExcludeEdgeBboxes = useCallback(() => {
    if (!frame || !selection) return;
    const edgeCells = collectEdgeCells(frame, grid);
    if (edgeCells.length === 0) return;
    excludeCells(selection.pos, edgeCells);
  }, [frame, grid, selection]);

  const handleResetExcludedCells = useCallback(() => {
    if (!selection) return;
    resetExcludedCells(selection.pos);
  }, [selection]);

  const handleExcludeAllVisibleCells = useCallback(() => {
    if (!selection || visibleCells.length === 0) return;
    excludeCells(selection.pos, visibleCells.map((cell) => ({ i: cell.i, j: cell.j })));
  }, [selection, visibleCells]);

  const handleApplyAutoExclude = useCallback(() => {
    if (!selection) return;

    const cellsToExclude =
      autoExcludePreview?.cellScores
        .filter((cell) => cell.score <= autoExcludeThreshold)
        .map((cell) => ({ i: cell.i, j: cell.j })) ?? [];

    if (cellsToExclude.length > 0) {
      excludeCells(selection.pos, cellsToExclude);
      showSuccessToast(`Auto excluded ${cellsToExclude.length} cells for Pos${selection.pos}`);
    } else {
      showSuccessToast(`Auto exclude found no cells for Pos${selection.pos}`);
    }

    setAutoExcludeOpen(false);
  }, [autoExcludePreview, autoExcludeThreshold, selection]);

  const bboxPath = useMemo(() => {
    if (!selection) return "bbox/Pos{n}.csv";
    return `bbox/Pos${selection.pos}.csv`;
  }, [selection]);
  const stateJsonPath = useMemo(() => {
    if (!selection) return "align/Pos{n}.json";
    return `align/Pos${selection.pos}.json`;
  }, [selection]);

  const canResetExcludedCells = !!selection && currentPositionExcludedCells.length > 0;
  const canExcludeAllVisibleCells = !!frame && !!selection && includedVisibleCount > 0;
  const canOpenAutoExclude = !!source && !!frame && !!selection && grid.enabled && includedVisibleCount > 0;
  const canApplyAutoExclude = !autoExcludeLoading && !!autoExcludePreview && !autoExcludeError;

  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-h-0 flex-col">
        <Navbar
          workspacePath={workspacePath}
          source={source}
          onPickWorkspace={onPickWorkspace}
          onOpenNd2={onOpenNd2}
          onOpenCzi={onOpenCzi}
          onClearSource={onClearSource}
        />

        <main className="flex-1 min-h-0 overflow-hidden">
          <div className="grid h-full min-h-0 min-w-0 grid-cols-[18rem_minmax(0,1fr)_18rem] items-stretch">
            <aside className="h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden divide-y divide-border border-r border-border px-5 py-4">
              <FrameNavigation />
              <IntensitySidebar
                frame={frame}
                contrastMin={contrastMin}
                contrastMax={contrastMax}
              />
              <SidebarSection title="Outputs">
                <SidebarField label="Bounding Box CSV">
                  <SidebarValue monospace>
                    {bboxPath}
                  </SidebarValue>
                </SidebarField>
                <SidebarField label="Align State JSON">
                  <SidebarValue monospace>
                    {stateJsonPath}
                  </SidebarValue>
                </SidebarField>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full justify-center px-3 text-xs"
                  disabled={!workspacePath || !frame || !selection || saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? "Saving..." : "Save"}
                </Button>
              </SidebarSection>
            </aside>

            <section className="h-full min-h-0 min-w-0 overflow-hidden">
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="m-4 flex min-h-0 flex-1 overflow-hidden">
                  <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden rounded-2xl border border-border/60 bg-black/10">
                    <CanvasSurface
                      frame={frame}
                      grid={grid}
                      previewGrid={previewGrid}
                      excludedCells={renderedExcludedCells}
                      loading={loading && !frame}
                      emptyText={emptyText}
                      cursor={canvasCursor}
                      onVirtualPointerDown={handleCanvasPointerDown}
                      onVirtualPointerMove={handleCanvasPointerMove}
                      onVirtualPointerUp={handleCanvasPointerEnd}
                      onVirtualPointerCancel={handleCanvasPointerEnd}
                      onVirtualWheel={handleCanvasWheel}
                    />
                  </div>
                </div>
              </div>
            </section>

            <aside className="h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden divide-y divide-border border-l border-border px-5 py-4">
              <GridSidebar grid={grid} disabled={controlsDisabled} />
              <SelectionSidebar
                disabled={controlsDisabled}
                frameReady={!!frame}
                gridEnabled={grid.enabled}
                selectionMode={selectionMode}
                includedVisibleCount={includedVisibleCount}
                excludedVisibleCount={excludedVisibleCount}
                canResetExcludedCells={canResetExcludedCells}
                canExcludeAllVisibleCells={canExcludeAllVisibleCells}
                canExcludeEdge={!!frame && !!selection}
                canOpenAutoExclude={canOpenAutoExclude}
                onResetExcluded={handleResetExcludedCells}
                onExcludeAll={handleExcludeAllVisibleCells}
                onExcludeEdge={handleExcludeEdgeBboxes}
                onOpenAutoExclude={() => setAutoExcludeOpen(true)}
              />
            </aside>
          </div>
        </main>
      </div>

      <AutoExcludeDialog
        open={autoExcludeOpen}
        loading={autoExcludeLoading}
        error={autoExcludeError}
        preview={autoExcludePreview}
        threshold={autoExcludeThreshold}
        selectionCount={autoExcludeSelectionCount}
        canApply={canApplyAutoExclude}
        onThresholdChange={setAutoExcludeThreshold}
        onClose={() => setAutoExcludeOpen(false)}
        onApply={handleApplyAutoExclude}
      />
    </div>
  );
}

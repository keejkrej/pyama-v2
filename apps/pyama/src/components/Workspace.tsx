import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type {
  AutoExcludePreviewRequest,
  ContrastWindow,
  FrameResult,
  DataPort,
  Source,
} from "@/lib/contracts";
import {
  buildBboxCsv,
  clamp,
  collectEdgeCells,
  countVisibleCells,
  degreesToRadians,
  enumerateVisibleGridCells,
  radiansToDegrees,
  toggleExcludedCells as toggleExcludedCellCoords,
  type GridCellCoord,
  type GridShape,
} from "@/lib/core";
import { AutoExcludeDialog } from "@/components/AutoExcludeDialog";
import {
  autoExcludeCount,
  clampThresholdToDomain,
  scoreDomainForPreview,
} from "@/components/AutoExclude";
import CanvasSurface from "@/components/CanvasSurface";
import {
  AppSelect,
  AppSlider,
  NumberInput,
  type SelectOption,
} from "@/components/Controls";
import { FrameNavigation } from "@/components/FrameNavigation";
import Navbar from "@/components/Navbar";
import {
  SidebarField,
  SidebarSection,
  SidebarSegmentedToggle,
  SidebarStat,
  SidebarValue,
} from "@/components/sidebar";
import { Button } from "@/components/ui";
import { contrastWindowForFrame } from "@/hooks/frameContrast";
import { useGridCanvasInteraction } from "@/hooks/useGridCanvasInteraction";
import { useSourceFrameLoad } from "@/hooks/useSourceFrameLoad";
import { useWorkspaceScanSync } from "@/hooks/useWorkspaceScanSync";
import { toErrorMessage } from "@/lib/errors";
import {
  useAutoExcludePreviewQuery,
  useSaveBboxMutation,
} from "@/lib/query";
import {
  excludeCells,
  patchViewState,
  reloadAutoContrast,
  resetExcludedCells,
  resetGrid,
  setGrid,
  setSaving,
  setSelectionMode,
  appStore,
} from "@/lib/store";
import { showErrorToast, showSuccessToast } from "@/lib/toast";

export interface WorkspaceProps {
  workspacePath: string | null;
  source: Source | null;
  backend: DataPort;
  onPickWorkspace: () => void | Promise<void>;
  onOpenNd2: () => void | Promise<void>;
  onOpenCzi: () => void | Promise<void>;
  onClearSource: () => void;
}

interface CachedFrame {
  frame: FrameResult;
}

function gridCellCoordKey(cell: GridCellCoord): string {
  return `${cell.i}:${cell.j}`;
}

class FrameCache {
  private readonly limit: number;

  private readonly map = new Map<string, CachedFrame>();

  constructor(limit = 12) {
    this.limit = limit;
  }

  get(key: string): CachedFrame | undefined {
    const found = this.map.get(key);
    if (!found) return undefined;
    this.map.delete(key);
    this.map.set(key, found);
    return found;
  }

  set(key: string, value: CachedFrame): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      const first = this.map.keys().next().value;
      if (!first) break;
      this.map.delete(first);
    }
  }
}

export default function Workspace({
  workspacePath,
  source,
  backend,
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

  const saveBboxMutation = useSaveBboxMutation(backend);

  useWorkspaceScanSync(backend, workspacePath, source);

  const contrastRequestKey =
    contrastMode === "auto" ? `auto:${contrastReloadToken}` : `${contrastMin}:${contrastMax}`;

  useSourceFrameLoad({
    backend,
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
  const contrastDomain = useMemo(() => contrastWindowForFrame(frame), [frame]);
  const contrastMinSliderMax = Math.max(contrastDomain.min + 1, contrastDomain.max) - 1;
  const contrastMaxSliderMin = Math.min(contrastDomain.max - 1, contrastDomain.min + 1);
  const [contrastDraft, setContrastDraft] = useState<ContrastWindow | null>(null);
  const gridDegrees = radiansToDegrees(grid.rotation);
  const minGridSpacing = Math.min(grid.cellWidth, grid.cellHeight);
  const shapeOptions = useMemo<SelectOption<GridShape>[]>(
    () => [
      { label: "Square", value: "square" },
      { label: "Hex", value: "hex" },
    ],
    [],
  );

  useEffect(() => {
    setContrastDraft({
      min: contrastMin,
      max: contrastMax,
    });
  }, [contrastMax, contrastMin]);

  const displayedContrast = contrastDraft ?? {
    min: contrastMin,
    max: contrastMax,
  };

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

  const autoExcludePreviewQuery = useAutoExcludePreviewQuery(backend, autoExcludeRequest);
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
        savedState: {
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

              <SidebarSection
                title="Intensity"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!frame}
                    className="h-7 px-2.5 text-xs"
                    onClick={reloadAutoContrast}
                  >
                    Auto Range
                  </Button>
                }
              >
                <SidebarField label="Min Intensity" hint={String(displayedContrast.min)}>
                  <AppSlider
                    value={displayedContrast.min}
                    min={contrastDomain.min}
                    max={contrastMinSliderMax}
                    step={1}
                    disabled={!frame}
                    onChange={(value) => {
                      setContrastDraft((current) => ({
                        min: clamp(
                          Math.round(value),
                          contrastDomain.min,
                          Math.min(contrastMinSliderMax, (current ?? displayedContrast).max - 1),
                        ),
                        max: (current ?? displayedContrast).max,
                      }));
                    }}
                    onCommit={(value) => {
                      patchViewState({
                        contrastMode: "manual",
                        contrastMin: clamp(
                          Math.round(value),
                          contrastDomain.min,
                          Math.min(contrastMinSliderMax, displayedContrast.max - 1),
                        ),
                      });
                    }}
                  />
                </SidebarField>
                <SidebarField label="Max Intensity" hint={String(displayedContrast.max)}>
                  <AppSlider
                    value={displayedContrast.max}
                    min={contrastMaxSliderMin}
                    max={contrastDomain.max}
                    step={1}
                    disabled={!frame}
                    onChange={(value) => {
                      setContrastDraft((current) => ({
                        min: (current ?? displayedContrast).min,
                        max: clamp(
                          Math.round(value),
                          Math.max(contrastMaxSliderMin, (current ?? displayedContrast).min + 1),
                          contrastDomain.max,
                        ),
                      }));
                    }}
                    onCommit={(value) => {
                      patchViewState({
                        contrastMode: "manual",
                        contrastMax: clamp(
                          Math.round(value),
                          Math.max(contrastMaxSliderMin, displayedContrast.min + 1),
                          contrastDomain.max,
                        ),
                      });
                    }}
                  />
                </SidebarField>
              </SidebarSection>

              <SidebarSection title="Outputs">
                <SidebarField label="Bounding Box CSV">
                  <SidebarValue monospace>
                    {bboxPath}
                  </SidebarValue>
                </SidebarField>
                <SidebarField label="State JSON">
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
              <SidebarSection
                title="Grid"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    disabled={controlsDisabled}
                    onClick={resetGrid}
                  >
                    Reset
                  </Button>
                }
              >
                <SidebarField label="Overlay">
                  <SidebarSegmentedToggle
                    value={grid.enabled ? "visible" : "hidden"}
                    options={[
                      { label: "Hidden", value: "hidden" },
                      { label: "Visible", value: "visible" },
                    ]}
                    compact
                    disabled={controlsDisabled}
                    onChange={(value) =>
                      setGrid((current) => ({ ...current, enabled: value === "visible" }))
                    }
                  />
                </SidebarField>
                <SidebarField label="Grid Shape">
                  <AppSelect
                    value={grid.shape}
                    options={shapeOptions}
                    disabled={controlsDisabled}
                    onChange={(value) => setGrid((current) => ({ ...current, shape: value }))}
                  />
                </SidebarField>

                <SidebarField label="Rotation" hint={`${gridDegrees.toFixed(1)}°`}>
                  <AppSlider
                    value={gridDegrees}
                    min={-180}
                    max={180}
                    step={0.1}
                    disabled={controlsDisabled}
                    onChange={(value) =>
                      setGrid((current) => ({
                        ...current,
                        rotation: degreesToRadians(value),
                      }))
                    }
                  />
                </SidebarField>

                <div className="grid grid-cols-2 gap-2">
                  <SidebarField label="Pitch A">
                    <NumberInput
                      value={grid.spacingA}
                      min={minGridSpacing}
                      disabled={controlsDisabled}
                      onChange={(value) =>
                        setGrid((current) => ({
                          ...current,
                          spacingA: Number.isFinite(value) && value > 0 ? value : 1,
                        }))
                      }
                    />
                  </SidebarField>
                  <SidebarField label="Pitch B">
                    <NumberInput
                      value={grid.spacingB}
                      min={minGridSpacing}
                      disabled={controlsDisabled}
                      onChange={(value) =>
                        setGrid((current) => ({
                          ...current,
                          spacingB: Number.isFinite(value) && value > 0 ? value : 1,
                        }))
                      }
                    />
                  </SidebarField>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <SidebarField label="Cell Width">
                    <NumberInput
                      value={grid.cellWidth}
                      disabled={controlsDisabled}
                      onChange={(value) =>
                        setGrid((current) => ({
                          ...current,
                          cellWidth: Number.isFinite(value) && value > 0 ? value : 1,
                        }))
                      }
                    />
                  </SidebarField>
                  <SidebarField label="Cell Height">
                    <NumberInput
                      value={grid.cellHeight}
                      disabled={controlsDisabled}
                      onChange={(value) =>
                        setGrid((current) => ({
                          ...current,
                          cellHeight: Number.isFinite(value) && value > 0 ? value : 1,
                        }))
                      }
                    />
                  </SidebarField>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <SidebarField label="Offset X">
                    <NumberInput
                      value={grid.tx}
                      disabled={controlsDisabled}
                      step="0.1"
                      onChange={(value) =>
                        setGrid((current) => ({ ...current, tx: Number.isFinite(value) ? value : 0 }))
                      }
                    />
                  </SidebarField>
                  <SidebarField label="Offset Y">
                    <NumberInput
                      value={grid.ty}
                      disabled={controlsDisabled}
                      step="0.1"
                      onChange={(value) =>
                        setGrid((current) => ({ ...current, ty: Number.isFinite(value) ? value : 0 }))
                      }
                    />
                  </SidebarField>
                </div>

                <SidebarField label="Overlay" hint={grid.opacity.toFixed(2)}>
                  <AppSlider
                    value={grid.opacity}
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={controlsDisabled}
                    onChange={(value) =>
                      setGrid((current) => ({ ...current, opacity: clamp(value, 0, 1) }))
                    }
                  />
                </SidebarField>
              </SidebarSection>

              <SidebarSection title="Selection">
                <SidebarField label="Mode">
                  <SidebarSegmentedToggle
                    value={selectionMode ? "edit" : "view"}
                    options={[
                      { label: "View", value: "view" },
                      { label: "Edit", value: "edit" },
                    ]}
                    compact
                    disabled={controlsDisabled || !frame || !grid.enabled}
                    onChange={(value) => setSelectionMode(value === "edit")}
                  />
                </SidebarField>
                <div className="grid grid-cols-2 gap-2">
                  <SidebarField label="Included Cells">
                    <SidebarStat value={includedVisibleCount} />
                  </SidebarField>
                  <SidebarField label="Excluded Cells">
                    <SidebarStat value={excludedVisibleCount} />
                  </SidebarField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 justify-center px-3 text-xs"
                    disabled={!canResetExcludedCells}
                    onClick={handleResetExcludedCells}
                  >
                    Reset Excluded
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 justify-center px-3 text-xs"
                    disabled={!canExcludeAllVisibleCells}
                    onClick={handleExcludeAllVisibleCells}
                  >
                    Exclude All
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 justify-center px-3 text-xs"
                    disabled={!frame || !selection}
                    onClick={handleExcludeEdgeBboxes}
                  >
                    Exclude Edge
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 justify-center px-3 text-xs"
                    disabled={!canOpenAutoExclude}
                    onClick={() => setAutoExcludeOpen(true)}
                  >
                    Auto Exclude
                  </Button>
                </div>
              </SidebarSection>
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

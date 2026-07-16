import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type {
  AutoExcludeHistogramBin,
  AutoExcludePreviewRequest,
  ContrastWindow,
  FrameResult,
  ViewerDataPort,
  ViewerSource,
} from "@/shared/contracts";
import {
  applyGridPointerGesture,
  applyGridWheelGesture,
  beginGridPointerGesture,
  isPrimaryMouseButton,
  type GridPointerGestureSession,
  type GridShape,
  type GridState,
} from "@/shared/core";
import {
  buildBboxCsv,
  clamp,
  collectEdgeCells,
  collectStrokeToggleCells,
  countVisibleCells,
  degreesToRadians,
  enumerateVisibleGridCells,
  radiansToDegrees,
  toggleExcludedCells as toggleExcludedCellCoords,
  type GridCellCoord,
} from "@/shared/core";
import {
  ViewerCanvasSurface,
  type ViewerCanvasPointerEvent,
  type ViewerCanvasWheelEvent,
} from "../alignment";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/shared/ui";
import {
  NavigationControls,
  SidebarField,
  SidebarSection,
  SidebarSegmentedToggle,
  SidebarStat,
  SidebarValue,
  showErrorToast,
  showSuccessToast,
} from "@/shared/react";
import {
  useAutoExcludePreviewQuery,
  useSaveBboxMutation,
} from "@/shared/query";
import { findNavigationOptionIndex, stepNavigationValue, toNavigationOptions } from "@/shared/react";

import {
  excludeCells,
  patchViewState,
  reloadAutoContrast,
  resetExcludedCells,
  resetGrid,
  setGrid,
  setSaving,
  setSelectionKey,
  setSelectionMode,
  setTimeSliderIndex,
  toggleExcludedCells as toggleStoredExcludedCells,
  viewerStore,
} from "./viewerStore";
import { toErrorMessage } from "./viewerEffects";
import { useViewerAlignWorkspaceScanSync } from "../hooks/useViewerAlignWorkspaceScanSync";
import { contrastWindowForFrame } from "../hooks/viewerFrameContrast";
import { useViewerSourceFrameLoad } from "../hooks/useViewerSourceFrameLoad";
import ViewerNavbar from "./ViewerNavbar";
import {
  AppSelect,
  AppSlider,
  NumberInput,
  type ViewerAlignOption,
} from "./viewerAlign/ViewerAlignControls";
import {
  AUTO_EXCLUDE_CHART_MARGIN,
  AUTO_EXCLUDE_X_AXIS_HEIGHT,
  AUTO_EXCLUDE_Y_AXIS_WIDTH,
  autoExcludeCount,
  clampThresholdToDomain,
  formatScore,
  scoreDomainForPreview,
  type AutoExcludeHistogramDatum,
} from "./viewerAlign/ViewerAlignAutoExclude";

interface ViewerAlignWorkspaceProps {
  workspacePath: string | null;
  source: ViewerSource | null;
  backend: ViewerDataPort;
  onPickWorkspace: () => void | Promise<void>;
  onOpenNd2: () => void | Promise<void>;
  onOpenCzi: () => void | Promise<void>;
  onClearSource: () => void;
}

interface CachedFrame {
  frame: FrameResult;
}

interface SelectionStroke {
  pointerId: number;
  hitCellKeys: Set<string>;
  hitCells: GridCellCoord[];
  lastPoint: { x: number; y: number } | null;
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

export default function ViewerAlignWorkspace({
  workspacePath,
  source,
  backend,
  onPickWorkspace,
  onOpenNd2,
  onOpenCzi,
  onClearSource,
}: ViewerAlignWorkspaceProps) {
  const frameCacheRef = useRef(new FrameCache());
  const dragSessionRef = useRef<GridPointerGestureSession | null>(null);
  const selectionStrokeRef = useRef<SelectionStroke | null>(null);
  const [previewGrid, setPreviewGrid] = useState<GridState | null>(null);
  const [selectionPreviewCells, setSelectionPreviewCells] = useState<GridCellCoord[] | null>(null);
  const [autoExcludeOpen, setAutoExcludeOpen] = useState(false);
  const [autoExcludeThreshold, setAutoExcludeThreshold] = useState<number>(0);
  const lastViewerErrorToastRef = useRef<string | null>(null);
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
    timeSliderIndex,
    selectionMode,
    excludedCellsByPosition,
    saving,
  } = useStore(
    viewerStore,
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
      timeSliderIndex: state.timeSliderIndex,
      selectionMode: state.selectionMode,
      excludedCellsByPosition: state.excludedCellsByPosition,
      saving: state.saving,
    })),
  );

  const saveBboxMutation = useSaveBboxMutation(backend);

  useViewerAlignWorkspaceScanSync(backend, workspacePath, source);

  const contrastRequestKey =
    contrastMode === "auto" ? `auto:${contrastReloadToken}` : `${contrastMin}:${contrastMax}`;

  useViewerSourceFrameLoad({
    backend,
    source,
    selection,
    contrastMode,
    contrastMin,
    contrastMax,
    contrastRequestKey,
    frameCacheRef,
  });

  const hasScan = !!scan && scan.positions.length > 0;
  const controlsDisabled = !hasScan || !selection;
  const contrastDomain = useMemo(() => contrastWindowForFrame(frame), [frame]);
  const contrastMinSliderMax = Math.max(contrastDomain.min + 1, contrastDomain.max) - 1;
  const contrastMaxSliderMin = Math.min(contrastDomain.max - 1, contrastDomain.min + 1);
  const [contrastDraft, setContrastDraft] = useState<ContrastWindow | null>(null);
  const gridDegrees = radiansToDegrees(grid.rotation);
  const minGridSpacing = Math.min(grid.cellWidth, grid.cellHeight);
  const positionOptions = useMemo(() => toNavigationOptions(scan?.positions ?? []), [scan]);
  const channelOptions = useMemo(() => toNavigationOptions(scan?.channels ?? []), [scan]);
  const zValues = scan?.zSlices ?? [];
  const selectedPosition = selection?.pos ?? positionOptions[0]?.value ?? null;
  const selectedChannel = selection?.channel ?? channelOptions[0]?.value ?? null;
  const selectedZ = selection?.z ?? zValues[0] ?? null;
  const selectedPositionIndex = findNavigationOptionIndex(positionOptions, selectedPosition);
  const selectedChannelIndex = findNavigationOptionIndex(channelOptions, selectedChannel);
  const selectedZIndex = useMemo(() => {
    if (!selection) return 0;
    const index = zValues.indexOf(selection.z);
    return index >= 0 ? index : 0;
  }, [selection, zValues]);
  const shapeOptions = useMemo<ViewerAlignOption<GridShape>[]>(
    () => [
      { label: "Square", value: "square" },
      { label: "Hex", value: "hex" },
    ],
    [],
  );
  const timeValues = scan?.times ?? [];
  const selectedTimeIndex = useMemo(() => {
    if (!selection) return 0;
    const index = timeValues.indexOf(selection.time);
    return index >= 0 ? index : 0;
  }, [selection, timeValues]);
  const [zSliderIndex, setZSliderIndex] = useState(0);
  const displayedTime = timeValues[timeSliderIndex] ?? selection?.time ?? 0;
  const timeSliderMax = Math.max(0, timeValues.length - 1);
  const displayedZ = zValues[zSliderIndex] ?? selection?.z ?? 0;
  const zSliderMax = Math.max(0, zValues.length - 1);

  useEffect(() => {
    setTimeSliderIndex(selectedTimeIndex);
  }, [selectedTimeIndex]);

  useEffect(() => {
    setZSliderIndex(selectedZIndex);
  }, [selectedZIndex]);

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
      lastViewerErrorToastRef.current = null;
      return;
    }
    if (lastViewerErrorToastRef.current === error) return;
    lastViewerErrorToastRef.current = error;
    showErrorToast(error);
  }, [error]);

  useEffect(() => {
    dragSessionRef.current = null;
    selectionStrokeRef.current = null;
    setPreviewGrid(null);
    setSelectionPreviewCells(null);
  }, [frame, selectionMode, selection?.pos]);

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
  const autoExcludeDomain = useMemo(
    () => scoreDomainForPreview(autoExcludePreview),
    [autoExcludePreview],
  );
  const autoExcludeHistogramData = useMemo<AutoExcludeHistogramDatum[]>(
    () =>
      (autoExcludePreview?.histogramBins ?? []).map((bin: AutoExcludeHistogramBin) => ({
        x: (bin.start + bin.end) / 2,
        start: bin.start,
        end: bin.end,
        count: bin.count,
      })),
    [autoExcludePreview],
  );
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
        showErrorToast(response.error ?? "Failed to save alignment outputs");
      } else {
        showSuccessToast(`Saved alignment for Pos${selection.pos}`);
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

  const handleOpenAutoExclude = useCallback(() => {
    setAutoExcludeOpen(true);
  }, []);

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
  const alignPath = useMemo(() => {
    if (!selection) return "align/Pos{n}.json";
    return `align/Pos${selection.pos}.json`;
  }, [selection]);

  const canResetExcludedCells = !!selection && currentPositionExcludedCells.length > 0;
  const canExcludeAllVisibleCells = !!frame && !!selection && includedVisibleCount > 0;
  const canOpenAutoExclude = !!source && !!frame && !!selection && grid.enabled && includedVisibleCount > 0;
  const canApplyAutoExclude = !autoExcludeLoading && !!autoExcludePreview && !autoExcludeError;
  const canvasCursor = selectionMode ? "crosshair" : grid.enabled ? (previewGrid ? "grabbing" : "grab") : "default";

  const collectSelectionStroke = useCallback(
    (stroke: SelectionStroke, point: { x: number; y: number }, startPoint: { x: number; y: number }) => {
      if (!frame) return;
      const fromPoint = stroke.lastPoint ?? startPoint;
      const nextCells = collectStrokeToggleCells(frame, grid, fromPoint, point, stroke.hitCells);
      for (const cell of nextCells) {
        const key = gridCellCoordKey(cell);
        if (stroke.hitCellKeys.has(key)) continue;
        stroke.hitCellKeys.add(key);
        stroke.hitCells.push(cell);
      }
      stroke.lastPoint = point;
      setSelectionPreviewCells(stroke.hitCells.slice());
    },
    [frame, grid],
  );

  const handleCanvasPointerDown = useCallback(
    (event: ViewerCanvasPointerEvent) => {
      if (selectionMode) {
        if (!frame || !selection || !isPrimaryMouseButton(event) || !event.framePoint) return;
        const stroke: SelectionStroke = {
          pointerId: event.pointerId,
          hitCellKeys: new Set<string>(),
          hitCells: [],
          lastPoint: null,
        };
        collectSelectionStroke(stroke, event.framePoint, event.framePoint);
        selectionStrokeRef.current = stroke;
        event.capturePointer();
        event.preventDefault();
        return;
      }

      if (!grid.enabled) return;
      const session = beginGridPointerGesture(grid, event);
      if (!session) return;
      dragSessionRef.current = session;
      event.capturePointer();
      event.preventDefault();
    },
    [collectSelectionStroke, frame, grid, selection, selectionMode],
  );

  const handleCanvasPointerMove = useCallback(
    (event: ViewerCanvasPointerEvent) => {
      if (selectionMode) {
        const stroke = selectionStrokeRef.current;
        if (!stroke || stroke.pointerId !== event.pointerId) return;
        if (!event.framePoint) {
          stroke.lastPoint = null;
          return;
        }
        collectSelectionStroke(stroke, event.framePoint, event.framePoint);
        event.preventDefault();
        return;
      }

      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId || !event.viewport) return;
      setPreviewGrid(applyGridPointerGesture(session, event, event.viewport));
      event.preventDefault();
    },
    [collectSelectionStroke, selectionMode],
  );

  const handleCanvasPointerEnd = useCallback(
    (event: ViewerCanvasPointerEvent) => {
      if (selectionMode) {
        const stroke = selectionStrokeRef.current;
        if (!stroke || stroke.pointerId !== event.pointerId) return;
        if (event.framePoint) {
          collectSelectionStroke(stroke, event.framePoint, event.framePoint);
        }
        selectionStrokeRef.current = null;
        setSelectionPreviewCells(null);
        if (selection && stroke.hitCells.length > 0) {
          toggleStoredExcludedCells(selection.pos, stroke.hitCells);
        }
        event.releasePointer();
        return;
      }

      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      dragSessionRef.current = null;
      if (previewGrid) {
        setGrid(previewGrid);
      }
      setPreviewGrid(null);
      event.releasePointer();
    },
    [collectSelectionStroke, previewGrid, selection, selectionMode],
  );

  const handleCanvasWheel = useCallback(
    (event: ViewerCanvasWheelEvent) => {
      if (!frame || !grid.enabled || selectionMode || !event.viewport) return;
      event.preventDefault();
      dragSessionRef.current = null;
      setPreviewGrid(null);
      setGrid(applyGridWheelGesture(grid, event, event.viewport));
    },
    [frame, grid, selectionMode],
  );

  const updateAutoExcludeThresholdFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const relativeX = (event.clientX - rect.left) / Math.max(rect.width, 1);
      const nextThreshold =
        autoExcludeDomain.min
        + clamp(relativeX, 0, 1) * (autoExcludeDomain.max - autoExcludeDomain.min);
      setAutoExcludeThreshold(clampThresholdToDomain(nextThreshold, autoExcludeDomain));
    },
    [autoExcludeDomain],
  );

  const handleAutoExcludeHistogramPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      updateAutoExcludeThresholdFromPointer(event);
    },
    [updateAutoExcludeThresholdFromPointer],
  );

  const handleAutoExcludeHistogramPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      updateAutoExcludeThresholdFromPointer(event);
    },
    [updateAutoExcludeThresholdFromPointer],
  );

  const handleAutoExcludeHistogramPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      updateAutoExcludeThresholdFromPointer(event);
    },
    [updateAutoExcludeThresholdFromPointer],
  );

  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-h-0 flex-col">
        <ViewerNavbar
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
              <SidebarSection title="Frame">
                <NavigationControls
                  position={{
                    value: selection?.pos ?? (positionOptions[0]?.value ?? 0),
                    options: positionOptions,
                    disabled: controlsDisabled,
                    onChange: (value) => setSelectionKey("pos", value),
                    previousDisabled: controlsDisabled || selectedPositionIndex <= 0,
                    nextDisabled: controlsDisabled || selectedPositionIndex >= positionOptions.length - 1,
                    onPrevious: () => {
                      const nextValue = stepNavigationValue(positionOptions, selectedPosition, -1);
                      if (nextValue != null && nextValue !== selection?.pos) {
                        setSelectionKey("pos", nextValue);
                      }
                    },
                    onNext: () => {
                      const nextValue = stepNavigationValue(positionOptions, selectedPosition, 1);
                      if (nextValue != null && nextValue !== selection?.pos) {
                        setSelectionKey("pos", nextValue);
                      }
                    },
                  }}
                  channel={{
                    value: selection?.channel ?? (channelOptions[0]?.value ?? 0),
                    options: channelOptions,
                    disabled: controlsDisabled,
                    onChange: (value) => setSelectionKey("channel", value),
                    previousDisabled: controlsDisabled || selectedChannelIndex <= 0,
                    nextDisabled: controlsDisabled || selectedChannelIndex >= channelOptions.length - 1,
                    onPrevious: () => {
                      const nextValue = stepNavigationValue(channelOptions, selectedChannel, -1);
                      if (nextValue != null && nextValue !== selection?.channel) {
                        setSelectionKey("channel", nextValue);
                      }
                    },
                    onNext: () => {
                      const nextValue = stepNavigationValue(channelOptions, selectedChannel, 1);
                      if (nextValue != null && nextValue !== selection?.channel) {
                        setSelectionKey("channel", nextValue);
                      }
                    },
                  }}
                  timepoint={{
                    hint: String(displayedTime),
                    value: timeSliderIndex,
                    min: 0,
                    max: timeSliderMax,
                    step: 1,
                    disabled: controlsDisabled || timeValues.length <= 1,
                    onChange: (nextIndex) => setTimeSliderIndex(clamp(Math.round(nextIndex), 0, timeSliderMax)),
                    onCommit: (nextIndex) => {
                      const rounded = clamp(Math.round(nextIndex), 0, timeSliderMax);
                      setTimeSliderIndex(rounded);
                      const nextTime = timeValues[rounded];
                      if (nextTime != null && nextTime !== selection?.time) {
                        setSelectionKey("time", nextTime);
                      }
                    },
                    previousDisabled: controlsDisabled || timeValues.length <= 1 || timeSliderIndex <= 0,
                    nextDisabled: controlsDisabled || timeValues.length <= 1 || timeSliderIndex >= timeSliderMax,
                    onPrevious: () => {
                      const nextIndex = Math.max(0, timeSliderIndex - 1);
                      setTimeSliderIndex(nextIndex);
                      const nextTime = timeValues[nextIndex];
                      if (nextTime != null && nextTime !== selection?.time) {
                        setSelectionKey("time", nextTime);
                      }
                    },
                    onNext: () => {
                      const nextIndex = Math.min(timeSliderMax, timeSliderIndex + 1);
                      setTimeSliderIndex(nextIndex);
                      const nextTime = timeValues[nextIndex];
                      if (nextTime != null && nextTime !== selection?.time) {
                        setSelectionKey("time", nextTime);
                      }
                    },
                  }}
                  zPlane={{
                    hint: String(displayedZ),
                    value: zSliderIndex,
                    min: 0,
                    max: zSliderMax,
                    step: 1,
                    disabled: controlsDisabled || zValues.length <= 1,
                    onChange: (nextIndex) => setZSliderIndex(clamp(Math.round(nextIndex), 0, zSliderMax)),
                    onCommit: (nextIndex) => {
                      const rounded = clamp(Math.round(nextIndex), 0, zSliderMax);
                      setZSliderIndex(rounded);
                      const nextZ = zValues[rounded];
                      if (nextZ != null && nextZ !== selection?.z) {
                        setSelectionKey("z", nextZ);
                      }
                    },
                    previousDisabled: controlsDisabled || zValues.length <= 1 || zSliderIndex <= 0,
                    nextDisabled: controlsDisabled || zValues.length <= 1 || zSliderIndex >= zSliderMax,
                    onPrevious: () => {
                      const nextIndex = Math.max(0, zSliderIndex - 1);
                      setZSliderIndex(nextIndex);
                      const nextZ = zValues[nextIndex];
                      if (nextZ != null && nextZ !== selection?.z) {
                        setSelectionKey("z", nextZ);
                      }
                    },
                    onNext: () => {
                      const nextIndex = Math.min(zSliderMax, zSliderIndex + 1);
                      setZSliderIndex(nextIndex);
                      const nextZ = zValues[nextIndex];
                      if (nextZ != null && nextZ !== selection?.z) {
                        setSelectionKey("z", nextZ);
                      }
                    },
                  }}
                />
              </SidebarSection>

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
                <SidebarField label="Align JSON">
                  <SidebarValue monospace>
                    {alignPath}
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
                    <ViewerCanvasSurface
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
                      { label: "Viewer", value: "view" },
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
                    Reset
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
                    onClick={handleOpenAutoExclude}
                  >
                    Auto Exclude
                  </Button>
                </div>
              </SidebarSection>
            </aside>
          </div>
        </main>
      </div>
      {autoExcludeOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4 py-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !autoExcludeLoading) {
              setAutoExcludeOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-2xl rounded-[1.5rem] border border-border/80 bg-card shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auto-exclude-title"
          >
            <div className="border-b border-border px-5 py-4">
              <div className="space-y-1">
                <h2 id="auto-exclude-title" className="text-base font-medium text-foreground">
                  Auto Exclude
                </h2>
                <p className="text-sm text-muted-foreground">
                  Exclude visible included cells at or below the flatness threshold.
                </p>
              </div>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <div>
                    {autoExcludePreview?.eligibleCellCount ?? 0} eligible, {autoExcludeSelectionCount} at threshold
                  </div>
                  <div>
                    threshold {formatScore(autoExcludeThreshold)}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Flatness histogram
                  </p>
                  <div className="text-xs text-muted-foreground">
                    {formatScore(autoExcludeDomain.min)} to {formatScore(autoExcludeDomain.max)}
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-background/45 p-3">
                  {autoExcludeLoading ? (
                    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                      Computing preview...
                    </div>
                  ) : autoExcludeError ? (
                    <div className="flex h-64 items-center justify-center text-sm text-rose-200">
                      {autoExcludeError}
                    </div>
                  ) : autoExcludePreview && autoExcludeHistogramData.length > 0 ? (
                    <div className="relative h-64 w-full select-none">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={autoExcludeHistogramData}
                          margin={AUTO_EXCLUDE_CHART_MARGIN}
                        >
                          <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" vertical={false} />
                          <XAxis
                            type="number"
                            dataKey="x"
                            domain={[autoExcludeDomain.min, autoExcludeDomain.max]}
                            tick={{ fill: "rgba(148, 163, 184, 0.85)", fontSize: 11 }}
                            tickLine={false}
                            axisLine={{ stroke: "rgba(148, 163, 184, 0.18)" }}
                            tickFormatter={(value: number) => formatScore(value)}
                          />
                          <YAxis
                            allowDecimals={false}
                            width={AUTO_EXCLUDE_Y_AXIS_WIDTH}
                            tick={{ fill: "rgba(148, 163, 184, 0.85)", fontSize: 11 }}
                            tickLine={false}
                            axisLine={{ stroke: "rgba(148, 163, 184, 0.18)" }}
                          />
                          <Tooltip
                            cursor={false}
                            contentStyle={{
                              background: "rgba(12, 16, 25, 0.96)",
                              border: "1px solid rgba(148, 163, 184, 0.2)",
                              borderRadius: "12px",
                              color: "rgb(226, 232, 240)",
                            }}
                            formatter={(value: number) => [value, "Count"]}
                            labelFormatter={(_label, payload) => {
                              const datum = payload?.[0]?.payload as AutoExcludeHistogramDatum | undefined;
                              return datum
                                ? `${formatScore(datum.start)} - ${formatScore(datum.end)}`
                                : "Flatness";
                            }}
                          />
                          <ReferenceLine
                            x={autoExcludeThreshold}
                            stroke="rgb(252, 165, 165)"
                            strokeWidth={2}
                          />
                          <Bar
                            dataKey="count"
                            fill="rgba(125, 211, 252, 0.85)"
                            stroke="rgba(125, 211, 252, 1)"
                            strokeWidth={1}
                            isAnimationActive={false}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                      <div
                        className="absolute touch-none"
                        style={{
                          top: `${AUTO_EXCLUDE_CHART_MARGIN.top}px`,
                          right: `${AUTO_EXCLUDE_CHART_MARGIN.right}px`,
                          bottom: `${AUTO_EXCLUDE_CHART_MARGIN.bottom + AUTO_EXCLUDE_X_AXIS_HEIGHT}px`,
                          left: `${AUTO_EXCLUDE_CHART_MARGIN.left + AUTO_EXCLUDE_Y_AXIS_WIDTH}px`,
                        }}
                        onPointerDown={handleAutoExcludeHistogramPointerDown}
                        onPointerMove={handleAutoExcludeHistogramPointerMove}
                        onPointerUp={handleAutoExcludeHistogramPointerUp}
                        onPointerCancel={handleAutoExcludeHistogramPointerUp}
                      />
                    </div>
                  ) : (
                    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                      No visible included cells are eligible for auto exclude.
                    </div>
                  )}
                </div>
              </div>

              <SidebarField label="Threshold">
                <NumberInput
                  value={autoExcludeThreshold}
                  step="0.01"
                  min={autoExcludeDomain.min}
                  disabled={autoExcludeLoading || !autoExcludePreview}
                  onChange={(value) =>
                    setAutoExcludeThreshold(clampThresholdToDomain(value, autoExcludeDomain))
                  }
                />
              </SidebarField>

              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 px-3 text-xs"
                  disabled={autoExcludeLoading}
                  onClick={() => setAutoExcludeOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-9 px-3 text-xs"
                  disabled={!canApplyAutoExclude}
                  onClick={handleApplyAutoExclude}
                >
                  Auto Exclude
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

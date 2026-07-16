import { useCallback, useEffect, useRef, useState } from "react";

import type { FrameResult, Selection } from "@/lib/contracts";
import {
  applyGridPointerGesture,
  applyGridWheelGesture,
  beginGridPointerGesture,
  collectStrokeToggleCells,
  isPrimaryMouseButton,
  type GridCellCoord,
  type GridPointerGestureSession,
  type GridState,
} from "@/lib/core";
import type {
  CanvasPointerEvent,
  CanvasWheelEvent,
} from "@/components/CanvasSurface";
import {
  setGrid,
  toggleExcludedCells as toggleStoredExcludedCells,
} from "@/lib/store";

interface SelectionStroke {
  pointerId: number;
  hitCellKeys: Set<string>;
  hitCells: GridCellCoord[];
  lastPoint: { x: number; y: number } | null;
}

function gridCellCoordKey(cell: GridCellCoord): string {
  return `${cell.i}:${cell.j}`;
}

export interface UseGridCanvasInteractionArgs {
  frame: FrameResult | null;
  grid: GridState;
  selection: Selection | null;
  selectionMode: boolean;
}

export function useGridCanvasInteraction({
  frame,
  grid,
  selection,
  selectionMode,
}: UseGridCanvasInteractionArgs) {
  const dragSessionRef = useRef<GridPointerGestureSession | null>(null);
  const selectionStrokeRef = useRef<SelectionStroke | null>(null);
  const [previewGrid, setPreviewGrid] = useState<GridState | null>(null);
  const [selectionPreviewCells, setSelectionPreviewCells] = useState<GridCellCoord[] | null>(null);

  useEffect(() => {
    dragSessionRef.current = null;
    selectionStrokeRef.current = null;
    setPreviewGrid(null);
    setSelectionPreviewCells(null);
  }, [frame, selectionMode, selection?.pos]);

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
    (event: CanvasPointerEvent) => {
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
    (event: CanvasPointerEvent) => {
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
    (event: CanvasPointerEvent) => {
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
    (event: CanvasWheelEvent) => {
      if (!frame || !grid.enabled || selectionMode || !event.viewport) return;
      event.preventDefault();
      dragSessionRef.current = null;
      setPreviewGrid(null);
      setGrid(applyGridWheelGesture(grid, event, event.viewport));
    },
    [frame, grid, selectionMode],
  );

  const canvasCursor = selectionMode
    ? "crosshair"
    : grid.enabled
      ? previewGrid
        ? "grabbing"
        : "grab"
      : "default";

  return {
    previewGrid,
    selectionPreviewCells,
    canvasCursor,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerEnd,
    handleCanvasWheel,
  };
}

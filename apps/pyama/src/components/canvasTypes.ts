import type { FrameResult, CanvasStatusMessage } from "@/lib/contracts";
import type { GridCellCoord, GridState, GridWheelViewport } from "@/lib/core";

export interface CanvasFramePoint {
  x: number;
  y: number;
}

export interface CanvasPointerEvent {
  pointerId: number;
  pointerType: string;
  button: number;
  buttons: number;
  clientX: number;
  clientY: number;
  framePoint: CanvasFramePoint | null;
  viewport: GridWheelViewport | null;
  preventDefault: () => void;
  capturePointer: () => void;
  releasePointer: () => void;
}

export interface CanvasWheelEvent {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  clientX: number;
  clientY: number;
  framePoint: CanvasFramePoint | null;
  viewport: GridWheelViewport | null;
  preventDefault: () => void;
}

export interface CanvasSurfaceProps {
  frame: FrameResult | null;
  grid: GridState;
  previewGrid?: GridState | null;
  excludedCells?: Iterable<GridCellCoord>;
  loading?: boolean;
  emptyText?: string;
  messages?: CanvasStatusMessage[];
  className?: string;
  cursor?: string;
  onVirtualPointerDown?: (event: CanvasPointerEvent) => void;
  onVirtualPointerMove?: (event: CanvasPointerEvent) => void;
  onVirtualPointerUp?: (event: CanvasPointerEvent) => void;
  onVirtualPointerCancel?: (event: CanvasPointerEvent) => void;
  onVirtualWheel?: (event: CanvasWheelEvent) => void;
}

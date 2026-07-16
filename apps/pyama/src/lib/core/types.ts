import type {
  GridCellCoord,
  GridShape,
  GridState,
} from "@/lib/contracts";

export type { GridCellCoord, GridShape, GridState };

export interface GridFrameBounds {
  width: number;
  height: number;
}

export interface GridWheelGestureInput {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export interface GridWheelViewport {
  displayWidth: number;
  displayHeight: number;
  modelWidth: number;
  modelHeight: number;
}

export type ExcludedCellsByPosition = Record<number, GridCellCoord[]>;

export interface MousePointerInput {
  pointerType: string;
  button: number;
}

export interface GridPointerGestureInput extends MousePointerInput {
  pointerId: number;
  clientX: number;
  clientY: number;
}

export interface GridPointerGestureSession {
  pointerId: number;
  intent: GridPointerIntent;
  startClientX: number;
  startClientY: number;
  startGrid: GridState;
}

export interface GridCellBox extends GridCellCoord {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type GridPointerIntent = "offset" | "rotation" | "spacing" | "spacing-size";
export type GridWheelIntent = "ignore" | "size";

/** Primary mouse button maps to the selected canvas tool. */
export type GridToolMode = "pan" | "rotate" | "zoom";

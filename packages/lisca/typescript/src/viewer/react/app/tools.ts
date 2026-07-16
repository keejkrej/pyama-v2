import type { GridState } from "lisca/shared/contracts";

export const Q20_PRESET = {
  shape: "square",
  spacingA: 168,
  spacingB: 168,
  cellWidth: 128,
  cellHeight: 128,
} satisfies Pick<GridState, "shape" | "spacingA" | "spacingB" | "cellWidth" | "cellHeight">;

export function applyQ20Preset(grid: GridState): GridState {
  return {
    ...grid,
    ...Q20_PRESET,
  };
}

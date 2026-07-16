import { describe, expect, test } from "bun:test";

import type { GridState } from "../../../src/shared/core";
import { applyQ20Preset } from "../../../src/viewer/react/app/tools";

const baseGrid: GridState = {
  enabled: true,
  shape: "hex",
  tx: 42,
  ty: -7,
  rotation: 0.35,
  spacingA: 325,
  spacingB: 325,
  cellWidth: 200,
  cellHeight: 200,
  opacity: 0.5,
};

describe("viewer tools", () => {
  test("applyQ20Preset updates only the preset grid fields", () => {
    expect(applyQ20Preset(baseGrid)).toEqual({
      ...baseGrid,
      shape: "square",
      spacingA: 168,
      spacingB: 168,
      cellWidth: 128,
      cellHeight: 128,
    });
  });
});

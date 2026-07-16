import { afterEach, describe, expect, test } from "bun:test";

import {
  applySavedState,
  IDLE_SAVE_STATE,
  resetExcludedCells,
  setWorkspacePath,
  appStore,
} from "../../src/lib/store";

const initialState = { ...appStore.getState() };

afterEach(() => {
  appStore.setState({ ...initialState });
});

describe("app store exclusion actions", () => {
  test("resetExcludedCells clears only the requested position", () => {
    appStore.setState({
      ...initialState,
      source: { kind: "nd2", path: "/tmp/source.nd2" },
      selection: { pos: 2, channel: 0, time: 0, z: 0 },
      excludedCellsByPosition: {
        2: [{ i: 0, j: 0 }, { i: 0, j: 1 }],
        3: [{ i: 1, j: 1 }],
      },
      saveState: { type: "success", message: "Saved bbox CSV for Pos2" },
    });

    resetExcludedCells(2);

    expect(appStore.getState().excludedCellsByPosition).toEqual({
      3: [{ i: 1, j: 1 }],
    });
    expect(appStore.getState().saveState).toEqual(IDLE_SAVE_STATE);
  });

  test("applySavedState replaces the grid and excluded cells for the position", () => {
    appStore.setState({
      ...initialState,
      source: { kind: "nd2", path: "/tmp/source.nd2" },
      selection: { pos: 5, channel: 0, time: 0, z: 0 },
      grid: {
        enabled: false,
        shape: "square",
        tx: 0,
        ty: 0,
        rotation: 0,
        spacingA: 325,
        spacingB: 325,
        cellWidth: 200,
        cellHeight: 200,
        opacity: 0.35,
      },
      excludedCellsByPosition: {
        5: [{ i: 0, j: 0 }],
        9: [{ i: 1, j: 1 }],
      },
    });

    applySavedState(5, {
      grid: {
        enabled: true,
        shape: "hex",
        tx: 10,
        ty: 11,
        rotation: 0.5,
        spacingA: 150,
        spacingB: 175,
        cellWidth: 90,
        cellHeight: 95,
        opacity: 0.4,
      },
      excludedCells: [{ i: 3, j: 4 }],
    });

    expect(appStore.getState().grid).toEqual({
      enabled: true,
      shape: "hex",
      tx: 10,
      ty: 11,
      rotation: 0.5,
      spacingA: 150,
      spacingB: 175,
      cellWidth: 90,
      cellHeight: 95,
      opacity: 0.4,
    });
    expect(appStore.getState().excludedCellsByPosition).toEqual({
      5: [{ i: 3, j: 4 }],
      9: [{ i: 1, j: 1 }],
    });
  });

  test("applySavedState keeps the current grid and clears exclusions when no saved state exists", () => {
    appStore.setState({
      ...initialState,
      source: { kind: "nd2", path: "/tmp/source.nd2" },
      selection: { pos: 6, channel: 0, time: 0, z: 0 },
      grid: {
        enabled: true,
        shape: "hex",
        tx: 4,
        ty: 5,
        rotation: 0.25,
        spacingA: 140,
        spacingB: 145,
        cellWidth: 80,
        cellHeight: 82,
        opacity: 0.45,
      },
      excludedCellsByPosition: {
        6: [{ i: 8, j: 9 }],
      },
    });

    applySavedState(6, null);

    expect(appStore.getState().grid).toEqual({
      enabled: true,
      shape: "hex",
      tx: 4,
      ty: 5,
      rotation: 0.25,
      spacingA: 140,
      spacingB: 145,
      cellWidth: 80,
      cellHeight: 82,
      opacity: 0.45,
    });
    expect(appStore.getState().excludedCellsByPosition).toEqual({});
  });
});

describe("app store workspace path", () => {
  test("setWorkspacePath updates the single session store", () => {
    setWorkspacePath("/tmp/ws-a");
    expect(appStore.getState().workspacePath).toBe("/tmp/ws-a");

    setWorkspacePath("/tmp/ws-b");
    expect(appStore.getState().workspacePath).toBe("/tmp/ws-b");

    setWorkspacePath(null);
    expect(appStore.getState().workspacePath).toBeNull();
  });
});

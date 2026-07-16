import { createStore } from "zustand/vanilla";

import type {
  FrameResult,
  AlignState,
  Selection,
  Source,
  WorkspaceScan,
} from "@/lib/contracts";
import {
  clearExcludedCells as clearExcludedCellsMap,
  createDefaultGrid,
  makeSourceKey,
  mergeExcludedCells as mergeExcludedCellCoords,
  normalizeGridState,
  setExcludedCellsForPosition,
  toggleExcludedCells as toggleExcludedCellCoords,
  type ExcludedCellsByPosition,
  type GridCellCoord,
  type GridState,
} from "@/lib/core";
import {
  persistStoredString,
  readStoredStringWithFallback,
  resolveSessionStorage,
  type SessionStorageLike,
} from "@/lib/state";

const LAST_IMAGE_SOURCE_KEY = "view.lastImageSource";
const LAST_WORKSPACE_KEY = "view.lastWorkspace";
const LAST_SOURCE_KEY = "view.lastSource";
const LAST_ROOT_KEY = "view.lastRoot";
const LAST_GRID_KEY = "view.grid";
const EXCLUDED_BBOX_KEY_PREFIX = "view.excludedBboxes";

export type SaveState =
  | { type: "idle"; message: null }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

export type ContrastMode = "auto" | "manual";
const DEFAULT_CONTRAST_MIN = 0;
const DEFAULT_CONTRAST_MAX = 65535;

type StorageLike = SessionStorageLike;

type StateUpdater<T> = T | ((current: T) => T);

export interface ViewStoreState {
  workspacePath: string | null;
  source: Source | null;
  scan: WorkspaceScan | null;
  selection: Selection | null;
  grid: GridState;
  frame: FrameResult | null;
  loading: boolean;
  error: string | null;
  contrastMin: number;
  contrastMax: number;
  contrastMode: ContrastMode;
  contrastReloadToken: number;
  timeSliderIndex: number;
  selectionMode: boolean;
  excludedCellsByPosition: ExcludedCellsByPosition;
  saveState: SaveState;
  saving: boolean;
}

export const IDLE_SAVE_STATE: SaveState = { type: "idle", message: null };

function resolveStorage(): StorageLike | null {
  return resolveSessionStorage();
}

function readStoredGrid(storage: StorageLike | null): GridState {
  if (!storage) return createDefaultGrid();
  try {
    const raw = storage.getItem(LAST_GRID_KEY);
    if (!raw) return createDefaultGrid();
    return normalizeGridState(JSON.parse(raw) as Partial<GridState>);
  } catch {
    return createDefaultGrid();
  }
}

function parseStoredSource(raw: string | null): Source | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<Source>;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.kind === "nd2" || parsed.kind === "czi") &&
      typeof parsed.path === "string" &&
      parsed.path
    ) {
      return { kind: parsed.kind, path: parsed.path };
    }
  } catch {}

  return null;
}

function parseLegacySource(raw: string | null): Source | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { kind?: string; path?: string };
    if (
      (parsed?.kind === "nd2" || parsed?.kind === "czi") &&
      typeof parsed.path === "string" &&
      parsed.path
    ) {
      return { kind: parsed.kind, path: parsed.path };
    }
  } catch {
    return null;
  }
  return null;
}

function readStoredWorkspacePath(storage: StorageLike | null): string | null {
  const stored = readStoredStringWithFallback(storage, LAST_WORKSPACE_KEY, LAST_ROOT_KEY);
  if (stored) return stored;

  const legacySource = parseLegacySource(storage?.getItem(LAST_SOURCE_KEY) ?? null);
  return legacySource?.path ?? null;
}

function readStoredSource(storage: StorageLike | null, workspacePath: string | null): Source | null {
  const source = parseStoredSource(storage?.getItem(LAST_IMAGE_SOURCE_KEY) ?? null);
  if (workspacePath && source) return source;

  const legacySource = parseLegacySource(storage?.getItem(LAST_SOURCE_KEY) ?? null);
  if (legacySource) return legacySource;

  return null;
}

function excludedBboxStorageKey(source: Source): string {
  return `${EXCLUDED_BBOX_KEY_PREFIX}:${encodeURIComponent(makeSourceKey(source))}`;
}

function isStoredGridCellCoord(value: unknown): value is GridCellCoord {
  return (
    !!value &&
    typeof value === "object" &&
    Number.isInteger((value as GridCellCoord).i) &&
    Number.isInteger((value as GridCellCoord).j)
  );
}

function readStoredExcludedCells(
  storage: StorageLike | null,
  source: Source | null,
): ExcludedCellsByPosition {
  if (!storage || !source) return {};

  try {
    let raw = storage.getItem(excludedBboxStorageKey(source));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed).flatMap(([position, value]) => {
      if (!Array.isArray(value)) return [];
      const numericPosition = Number(position);
      if (!Number.isInteger(numericPosition)) return [];
      return [
        [
          numericPosition,
          value.filter(isStoredGridCellCoord),
        ] as const,
      ];
    });
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function persistWorkspacePath(storage: StorageLike | null, workspacePath: string | null) {
  persistStoredString(storage, LAST_WORKSPACE_KEY, workspacePath, LAST_ROOT_KEY);
}

function persistSource(storage: StorageLike | null, source: Source | null) {
  if (!storage) return;
  if (source) {
    storage.setItem(LAST_IMAGE_SOURCE_KEY, JSON.stringify(source));
  } else {
    storage.removeItem(LAST_IMAGE_SOURCE_KEY);
  }
  storage.removeItem(LAST_SOURCE_KEY);
}

function persistGrid(storage: StorageLike | null, grid: GridState) {
  if (!storage) return;
  storage.setItem(LAST_GRID_KEY, JSON.stringify(grid));
}

function persistExcludedCells(
  storage: StorageLike | null,
  source: Source | null,
  excludedCellsByPosition: ExcludedCellsByPosition,
) {
  if (!storage || !source) return;
  if (Object.keys(excludedCellsByPosition).length === 0) {
    storage.removeItem(excludedBboxStorageKey(source));
    return;
  }
  storage.setItem(excludedBboxStorageKey(source), JSON.stringify(excludedCellsByPosition));
}

function resolveNextValue<T>(current: T, next: StateUpdater<T>): T {
  if (typeof next === "function") {
    return (next as (value: T) => T)(current);
  }
  return next;
}

function replaceExcludedCellsForPosition(
  current: ExcludedCellsByPosition,
  position: number,
  cells: Iterable<GridCellCoord>,
): ExcludedCellsByPosition {
  return setExcludedCellsForPosition(current, position, Array.from(cells));
}

function resetAppState(
  state: ViewStoreState,
  overrides: Partial<ViewStoreState> = {},
): ViewStoreState {
  return {
    ...state,
    scan: null,
    selection: null,
    frame: null,
    loading: false,
    error: null,
    contrastMin: DEFAULT_CONTRAST_MIN,
    contrastMax: DEFAULT_CONTRAST_MAX,
    contrastMode: "manual",
    contrastReloadToken: 0,
    timeSliderIndex: 0,
    selectionMode: false,
    saveState: IDLE_SAVE_STATE,
    saving: false,
    ...overrides,
  };
}

function createInitialState(): ViewStoreState {
  const storage = resolveStorage();
  const workspacePath = readStoredWorkspacePath(storage);
  const source = readStoredSource(storage, workspacePath);

  return {
    workspacePath,
    source,
    scan: null,
    selection: null,
    grid: readStoredGrid(storage),
    frame: null,
    loading: false,
    error: null,
    contrastMin: DEFAULT_CONTRAST_MIN,
    contrastMax: DEFAULT_CONTRAST_MAX,
    contrastMode: "manual",
    contrastReloadToken: 0,
    timeSliderIndex: 0,
    selectionMode: false,
    excludedCellsByPosition: readStoredExcludedCells(storage, source),
    saveState: IDLE_SAVE_STATE,
    saving: false,
  };
}

export const appStore = createStore<ViewStoreState>(() => createInitialState());

export function setWorkspacePath(workspacePath: string | null) {
  persistWorkspacePath(resolveStorage(), workspacePath);
  appStore.setState((state) => ({ ...state, workspacePath }));
}

export function setSource(source: Source | null) {
  const storage = resolveStorage();
  persistSource(storage, source);
  appStore.setState((state) =>
    resetAppState(state, {
      source,
      excludedCellsByPosition: readStoredExcludedCells(storage, source),
    }),
  );
}

export function patchViewState(patch: Partial<ViewStoreState>) {
  appStore.setState((state) => ({ ...state, ...patch }));
}

export function setGrid(next: StateUpdater<GridState>) {
  appStore.setState((state) => {
    const grid = resolveNextValue(state.grid, next);
    persistGrid(resolveStorage(), grid);
    return { ...state, grid };
  });
}

export function resetGrid() {
  appStore.setState((state) => {
    const grid = {
      ...createDefaultGrid(),
      enabled: state.grid.enabled,
    };
    const excludedCellsByPosition = clearExcludedCellsMap();
    persistGrid(resolveStorage(), grid);
    persistExcludedCells(resolveStorage(), state.source, excludedCellsByPosition);
    return {
      ...state,
      grid,
      excludedCellsByPosition,
      saveState: IDLE_SAVE_STATE,
    };
  });
}

export function toggleGridEnabled() {
  appStore.setState((state) => {
    const grid = { ...state.grid, enabled: !state.grid.enabled };
    persistGrid(resolveStorage(), grid);
    return { ...state, grid };
  });
}

export function setSelectionKey<K extends keyof Selection>(
  key: K,
  value: Selection[K],
) {
  appStore.setState((state) => {
    if (!state.selection) return state;
    return {
      ...state,
      selection: { ...state.selection, [key]: value },
      saveState: IDLE_SAVE_STATE,
    };
  });
}

export function setTimeSliderIndex(timeSliderIndex: number) {
  appStore.setState((state) => ({ ...state, timeSliderIndex }));
}

export function setSelectionMode(selectionMode: boolean | ((current: boolean) => boolean)) {
  appStore.setState((state) => ({
    ...state,
    selectionMode: resolveNextValue(state.selectionMode, selectionMode),
  }));
}

export function setSaveState(saveState: SaveState) {
  appStore.setState((state) => ({ ...state, saveState }));
}

export function setSaving(saving: boolean) {
  appStore.setState((state) => ({ ...state, saving }));
}

export function reloadAutoContrast() {
  appStore.setState((state) => ({
    ...state,
    contrastMode: "auto",
    contrastReloadToken: state.contrastReloadToken + 1,
  }));
}

export function toggleExcludedCells(position: number, cells: Iterable<GridCellCoord>) {
  appStore.setState((state) => {
    const nextCells = toggleExcludedCellCoords(state.excludedCellsByPosition[position] ?? [], cells);
    const currentCells = state.excludedCellsByPosition[position] ?? [];
    if (
      nextCells.length === currentCells.length &&
      nextCells.every(
        (cell, index) => cell.i === currentCells[index]?.i && cell.j === currentCells[index]?.j,
      )
    ) {
      return state;
    }

    const excludedCellsByPosition = setExcludedCellsForPosition(
      state.excludedCellsByPosition,
      position,
      nextCells,
    );

    persistExcludedCells(resolveStorage(), state.source, excludedCellsByPosition);

    return {
      ...state,
      excludedCellsByPosition,
      saveState: IDLE_SAVE_STATE,
    };
  });
}

export function excludeCells(position: number, cells: Iterable<GridCellCoord>) {
  appStore.setState((state) => {
    const nextCells = mergeExcludedCellCoords(state.excludedCellsByPosition[position] ?? [], cells);
    const currentCells = state.excludedCellsByPosition[position] ?? [];
    if (
      nextCells.length === currentCells.length &&
      nextCells.every(
        (cell, index) => cell.i === currentCells[index]?.i && cell.j === currentCells[index]?.j,
      )
    ) {
      return state;
    }

    const excludedCellsByPosition = setExcludedCellsForPosition(
      state.excludedCellsByPosition,
      position,
      nextCells,
    );

    persistExcludedCells(resolveStorage(), state.source, excludedCellsByPosition);

    return {
      ...state,
      excludedCellsByPosition,
      saveState: IDLE_SAVE_STATE,
    };
  });
}

export function resetExcludedCells(position: number) {
  appStore.setState((state) => {
    if (!(position in state.excludedCellsByPosition)) {
      return state;
    }

    const excludedCellsByPosition = setExcludedCellsForPosition(
      state.excludedCellsByPosition,
      position,
      [],
    );

    persistExcludedCells(resolveStorage(), state.source, excludedCellsByPosition);

    return {
      ...state,
      excludedCellsByPosition,
      saveState: IDLE_SAVE_STATE,
    };
  });
}

export function applyAlignState(position: number, alignState: AlignState | null) {
  appStore.setState((state) => {
    const excludedCellsByPosition = replaceExcludedCellsForPosition(
      state.excludedCellsByPosition,
      position,
      alignState?.excludedCells ?? [],
    );
    const grid = alignState ? normalizeGridState(alignState.grid) : state.grid;
    const storage = resolveStorage();

    if (alignState) {
      persistGrid(storage, grid);
    }
    persistExcludedCells(storage, state.source, excludedCellsByPosition);

    return {
      ...state,
      grid,
      excludedCellsByPosition,
      saveState: IDLE_SAVE_STATE,
    };
  });
}

export interface WorkspaceScan {
  positions: number[];
  channels: number[];
  times: number[];
  zSlices: number[];
}

export interface Nd2Source {
  kind: "nd2";
  path: string;
}

export interface CziSource {
  kind: "czi";
  path: string;
}

export type ViewerSource = Nd2Source | CziSource;

export type PixelType =
  | "uint8"
  | "uint8clamped"
  | "int8"
  | "uint16"
  | "int16"
  | "uint32"
  | "int32";

export type PixelArray =
  | Uint8Array
  | Uint8ClampedArray
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array;

export interface FrameRequest {
  pos: number;
  channel: number;
  time: number;
  z: number;
}

export type GridShape = "square" | "hex";

export interface GridState {
  enabled: boolean;
  shape: GridShape;
  tx: number;
  ty: number;
  rotation: number;
  spacingA: number;
  spacingB: number;
  cellWidth: number;
  cellHeight: number;
  opacity: number;
}

export interface GridCellCoord {
  i: number;
  j: number;
}

export interface SavedAlignState {
  grid: GridState;
  excludedCells: GridCellCoord[];
}

export interface FrameResult {
  width: number;
  height: number;
  pixels: PixelArray;
  pixelType?: PixelType;
  contrastDomain?: ContrastWindow;
  suggestedContrast?: ContrastWindow;
  appliedContrast?: ContrastWindow;
}

export interface ViewerDataSource {
  scanSource(source: ViewerSource): Promise<WorkspaceScan>;
  loadFrame(source: ViewerSource, request: FrameRequest, options?: LoadFrameOptions): Promise<FrameResult>;
}

export interface HostFsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface HostListDirectoryResult {
  /** Null at the virtual roots listing (drives / top-level). */
  path: string | null;
  parent: string | null;
  entries: HostFsEntry[];
}

/** Modes for the in-browser filesystem picker (mirrors native dialog intents). */
export type HostFilePickerMode =
  | "workspace"
  | "nd2_file"
  | "czi_file";

export interface ViewerDataPort extends ViewerDataSource {
  listSavedBboxPositions(workspacePath: string): Promise<number[]>;
  loadAlignState(workspacePath: string, pos: number): Promise<SavedAlignState | null>;
  autoExcludePreview(request: AutoExcludePreviewRequest): Promise<AutoExcludePreviewResponse>;
  saveBbox(
    workspacePath: string,
    source: ViewerSource,
    pos: number,
    csv: string,
    alignState: SavedAlignState,
  ): Promise<SaveBboxResponse>;
}

export interface ViewerHostPort {
  listDirectory(path: string | null): Promise<HostListDirectoryResult>;
  userHomeDirectory(): Promise<string>;
  readTextFile(path: string): Promise<string>;
}

export interface ViewerSelection {
  pos: number;
  channel: number;
  time: number;
  z: number;
}

export interface ContrastWindow {
  min: number;
  max: number;
}

export interface AutoExcludePreviewRequest {
  source: ViewerSource;
  selection: FrameRequest;
  cells: AutoExcludePreviewCell[];
}

export interface AutoExcludePreviewCell {
  i: number;
  j: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AutoExcludePreviewCellScore {
  i: number;
  j: number;
  score: number;
}

export interface AutoExcludeHistogramBin {
  start: number;
  end: number;
  count: number;
}

export interface AutoExcludePreviewResponse {
  eligibleCellCount: number;
  cellScores: AutoExcludePreviewCellScore[];
  histogramBins: AutoExcludeHistogramBin[];
  scoreMin: number;
  scoreMax: number;
  threshold: number;
}

export interface LoadFrameOptions {
  contrast?: ContrastWindow;
}

export type ViewerCanvasStatusTone = "default" | "error" | "success";

export interface ViewerCanvasStatusMessage {
  text: string;
  tone?: ViewerCanvasStatusTone;
}

export interface SaveBboxResponse {
  ok: boolean;
  error?: string;
}

import type { AutoExcludePreviewRequest, Source } from "@/lib/contracts";

/**
 * Stable query keys for DataPort-backed queries.
 *
 * Policy: never key or cache {@link import("@/lib/contracts").FrameResult}
 * (pixel buffers).
 */
export const queryKeys = {
  all: ["lisca"] as const,

  scanSource: (source: Source) =>
    [...queryKeys.all, "scanSource", source.kind, source.path] as const,

  savedBboxPositions: (workspacePath: string) =>
    [...queryKeys.all, "savedBboxPositions", workspacePath] as const,

  savedState: (workspacePath: string, pos: number) =>
    [...queryKeys.all, "savedState", workspacePath, pos] as const,

  autoExcludePreview: (request: AutoExcludePreviewRequest) =>
    [
      ...queryKeys.all,
      "autoExcludePreview",
      request.source.kind,
      request.source.path,
      request.selection.pos,
      request.selection.channel,
      request.selection.time,
      request.selection.z,
      stablePreviewCellsKey(request.cells),
    ] as const,
};

function stablePreviewCellsKey(
  cells: AutoExcludePreviewRequest["cells"],
): string {
  if (cells.length === 0) return "cells:[]";
  const sorted = [...cells].sort((a, b) => a.i - b.i || a.j - b.j);
  return JSON.stringify(sorted);
}

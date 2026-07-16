import type { UseQueryOptions } from "@tanstack/react-query";

import type {
  AutoExcludePreviewRequest,
  AutoExcludePreviewResponse,
  AlignState,
  DataPort,
  Source,
  WorkspaceScan,
} from "@/lib/contracts";

import { queryKeys } from "./queryKeys";

type AppQueryOptions<T> = UseQueryOptions<T, Error, T, readonly unknown[]>;

export const QUERY_STALE_TIME = {
  workspaceScan: 60_000,
  preview: 0,
  metadata: 30_000,
} as const;

export function scanSourceQueryOptions(backend: DataPort, source: Source) {
  return {
    queryKey: queryKeys.scanSource(source),
    queryFn: ({ signal }) => {
      void signal;
      return backend.scanSource(source);
    },
    staleTime: QUERY_STALE_TIME.workspaceScan,
  } satisfies AppQueryOptions<WorkspaceScan>;
}

export function savedBboxPositionsQueryOptions(backend: DataPort, workspacePath: string) {
  return {
    queryKey: queryKeys.savedBboxPositions(workspacePath),
    queryFn: ({ signal }) => {
      void signal;
      return backend.listSavedBboxPositions(workspacePath);
    },
    staleTime: QUERY_STALE_TIME.metadata,
  } satisfies AppQueryOptions<number[]>;
}

export function alignStateQueryOptions(backend: DataPort, workspacePath: string, pos: number) {
  return {
    queryKey: queryKeys.alignState(workspacePath, pos),
    queryFn: ({ signal }) => {
      void signal;
      return backend.loadAlignState(workspacePath, pos);
    },
    staleTime: QUERY_STALE_TIME.metadata,
  } satisfies AppQueryOptions<AlignState | null>;
}

export function autoExcludePreviewQueryOptions(backend: DataPort, request: AutoExcludePreviewRequest) {
  return {
    queryKey: queryKeys.autoExcludePreview(request),
    queryFn: ({ signal }) => {
      void signal;
      return backend.autoExcludePreview(request);
    },
    staleTime: QUERY_STALE_TIME.preview,
  } satisfies AppQueryOptions<AutoExcludePreviewResponse>;
}

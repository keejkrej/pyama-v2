import type { UseQueryOptions } from "@tanstack/react-query";

import type {
  AutoExcludePreviewRequest,
  AutoExcludePreviewResponse,
  AlignState,
  HostApi,
  Source,
  WorkspaceScan,
} from "@/lib/contracts";

import { queryKeys } from "./query-keys";

type AppQueryOptions<T> = UseQueryOptions<T, Error, T, readonly unknown[]>;

export const QUERY_STALE_TIME = {
  workspaceScan: 60_000,
  preview: 0,
  metadata: 30_000,
} as const;

export function scanSourceQueryOptions(api: HostApi, source: Source) {
  return {
    queryKey: queryKeys.scanSource(source),
    queryFn: ({ signal }) => {
      void signal;
      return api.scanSource(source);
    },
    staleTime: QUERY_STALE_TIME.workspaceScan,
  } satisfies AppQueryOptions<WorkspaceScan>;
}

export function savedBboxPositionsQueryOptions(api: HostApi, workspacePath: string) {
  return {
    queryKey: queryKeys.savedBboxPositions(workspacePath),
    queryFn: ({ signal }) => {
      void signal;
      return api.listSavedBboxPositions(workspacePath);
    },
    staleTime: QUERY_STALE_TIME.metadata,
  } satisfies AppQueryOptions<number[]>;
}

export function alignStateQueryOptions(api: HostApi, workspacePath: string, pos: number) {
  return {
    queryKey: queryKeys.alignState(workspacePath, pos),
    queryFn: ({ signal }) => {
      void signal;
      return api.loadAlignState(workspacePath, pos);
    },
    staleTime: QUERY_STALE_TIME.metadata,
  } satisfies AppQueryOptions<AlignState | null>;
}

export function autoExcludePreviewQueryOptions(api: HostApi, request: AutoExcludePreviewRequest) {
  return {
    queryKey: queryKeys.autoExcludePreview(request),
    queryFn: ({ signal }) => {
      void signal;
      return api.autoExcludePreview(request);
    },
    staleTime: QUERY_STALE_TIME.preview,
  } satisfies AppQueryOptions<AutoExcludePreviewResponse>;
}

/**
 * Shared TanStack Query integration for `HostApi` IPC.
 *
 * **Cache policy:** queryFns in this module never persist {@link import("@/lib/contracts").FrameResult}
 * (pixel buffers).
 */

export { createQueryClient } from "./create-query-client";
export { QueryProvider } from "./query-provider";
export { queryKeys } from "./query-keys";
export {
  QUERY_STALE_TIME,
  alignStateQueryOptions,
  autoExcludePreviewQueryOptions,
  savedBboxPositionsQueryOptions,
  scanSourceQueryOptions,
} from "./query-options";
export {
  useAlignStateQuery,
  useAutoExcludePreviewQuery,
  useSaveBboxMutation,
  useSavedBboxPositionsQuery,
  useScanSourceQuery,
} from "./hooks";

/**
 * Shared TanStack Query integration for `DataPort` IPC.
 *
 * **Cache policy:** queryFns in this module never persist {@link import("@/lib/contracts").FrameResult}
 * (pixel buffers).
 */

export { createQueryClient } from "./createQueryClient";
export { QueryProvider } from "./QueryProvider";
export { queryKeys } from "./queryKeys";
export {
  QUERY_STALE_TIME,
  savedStateQueryOptions,
  autoExcludePreviewQueryOptions,
  savedBboxPositionsQueryOptions,
  scanSourceQueryOptions,
} from "./queryOptions";
export {
  useSavedStateQuery,
  useAutoExcludePreviewQuery,
  useSaveBboxMutation,
  useSavedBboxPositionsQuery,
  useScanSourceQuery,
} from "./hooks";

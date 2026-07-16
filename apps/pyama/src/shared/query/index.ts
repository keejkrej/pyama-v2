/**
 * Shared TanStack Query integration for `ViewerDataPort` IPC.
 *
 * **Cache policy:** queryFns in this module never persist {@link import("@/shared/contracts").FrameResult}
 * (pixel buffers).
 */

export { createQueryClient } from "./createQueryClient";
export { QueryProvider } from "./QueryProvider";
export { queryKeys } from "./queryKeys";
export {
  QUERY_STALE_TIME,
  alignStateQueryOptions,
  autoExcludePreviewQueryOptions,
  savedBboxPositionsQueryOptions,
  scanSourceQueryOptions,
} from "./queryOptions";
export { fetchAutoExcludePreview, fetchSavedBboxPositions } from "./imperativeFetch";
export {
  useAlignStateQuery,
  useAutoExcludePreviewQuery,
  useSaveBboxMutation,
  useSavedBboxPositionsQuery,
  useScanSourceQuery,
} from "./hooks";

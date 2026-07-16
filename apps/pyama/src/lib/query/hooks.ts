import {
  useMutation,
  useQuery,
  useQueryClient,
  skipToken,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";

import type {
  AutoExcludePreviewRequest,
  AutoExcludePreviewResponse,
  AlignState,
  SaveBboxResponse,
  HostApi,
  Source,
  WorkspaceScan,
} from "@/lib/contracts";

import { queryKeys } from "./queryKeys";
import {
  alignStateQueryOptions,
  autoExcludePreviewQueryOptions,
  savedBboxPositionsQueryOptions,
  scanSourceQueryOptions,
} from "./queryOptions";

type HookQueryOptions<T> = Omit<
  UseQueryOptions<T, Error, T, readonly unknown[]>,
  "queryKey" | "queryFn" | "initialData"
>;

type QueryFactory<T> = Pick<
  UseQueryOptions<T, Error, T, readonly unknown[]>,
  "queryKey" | "queryFn" | "staleTime" | "gcTime"
>;

// --- Reads ---

function disabledQueryOptions<T>(): Pick<
  UseQueryOptions<T, Error, T, readonly unknown[]>,
  "queryKey" | "queryFn"
> {
  return {
    queryKey: queryKeys.all,
    queryFn: skipToken as UseQueryOptions<T, Error, T, readonly unknown[]>["queryFn"],
  };
}

function enabledQueryOptions<T>(
  queryOptions: QueryFactory<T> | null,
  options?: HookQueryOptions<T>,
) {
  return {
    ...(queryOptions ?? disabledQueryOptions<T>()),
    ...options,
    enabled: queryOptions !== null && (options?.enabled ?? true),
  };
}

export function useScanSourceQuery(
  api: HostApi | null | undefined,
  source: Source | null | undefined,
  options?: HookQueryOptions<WorkspaceScan>,
) {
  return useQuery(
    enabledQueryOptions(
      api && source ? scanSourceQueryOptions(api, source) : null,
      options,
    ),
  );
}

export function useSavedBboxPositionsQuery(
  api: HostApi | null | undefined,
  workspacePath: string | null | undefined,
  options?: HookQueryOptions<number[]>,
) {
  return useQuery(
    enabledQueryOptions(
      api && workspacePath
        ? savedBboxPositionsQueryOptions(api, workspacePath)
        : null,
      options,
    ),
  );
}

export function useAlignStateQuery(
  api: HostApi | null | undefined,
  workspacePath: string | null | undefined,
  pos: number | null | undefined,
  options?: Omit<
    UseQueryOptions<AlignState | null, Error, AlignState | null, readonly unknown[]>,
    "queryKey" | "queryFn" | "initialData"
  >,
) {
  const canQuery =
    !!api && !!workspacePath && pos != null && !Number.isNaN(pos);
  return useQuery(
    enabledQueryOptions(
      canQuery ? alignStateQueryOptions(api, workspacePath, pos) : null,
      options,
    ),
  );
}

export function useAutoExcludePreviewQuery(
  api: HostApi | null | undefined,
  request: AutoExcludePreviewRequest | null | undefined,
  options?: Omit<
    UseQueryOptions<AutoExcludePreviewResponse, Error, AutoExcludePreviewResponse, readonly unknown[]>,
    "queryKey" | "queryFn" | "initialData"
  >,
) {
  return useQuery({
    ...enabledQueryOptions(
      api && request ? autoExcludePreviewQueryOptions(api, request) : null,
      options,
    ),
    staleTime: options?.staleTime ?? 0,
  });
}

// --- Mutations ---

function requireApi(api: HostApi | null | undefined): HostApi {
  if (!api) {
    throw new Error("Host API is not available");
  }
  return api;
}

export function useSaveBboxMutation(
  api: HostApi | null | undefined,
  options?: UseMutationOptions<
    SaveBboxResponse,
    Error,
    {
      workspacePath: string;
      source: Source;
      pos: number;
      csv: string;
      alignState: AlignState;
    }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ workspacePath, source, pos, csv, alignState }) =>
      requireApi(api).saveBbox(workspacePath, source, pos, csv, alignState),
    onSuccess: (data, variables, onMutateResult, context) => {
      if (data.ok) {
        qc.setQueryData<number[]>(
          queryKeys.savedBboxPositions(variables.workspacePath),
          (current) => {
            const positions = new Set(current ?? []);
            positions.add(variables.pos);
            return [...positions].sort((a, b) => a - b);
          },
        );
        qc.setQueryData(
          queryKeys.alignState(variables.workspacePath, variables.pos),
          variables.alignState,
        );
      }
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

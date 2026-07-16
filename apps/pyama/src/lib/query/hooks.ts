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
  DataPort,
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
  backend: DataPort | null | undefined,
  source: Source | null | undefined,
  options?: HookQueryOptions<WorkspaceScan>,
) {
  return useQuery(
    enabledQueryOptions(
      backend && source ? scanSourceQueryOptions(backend, source) : null,
      options,
    ),
  );
}

export function useSavedBboxPositionsQuery(
  backend: DataPort | null | undefined,
  workspacePath: string | null | undefined,
  options?: HookQueryOptions<number[]>,
) {
  return useQuery(
    enabledQueryOptions(
      backend && workspacePath
        ? savedBboxPositionsQueryOptions(backend, workspacePath)
        : null,
      options,
    ),
  );
}

export function useAlignStateQuery(
  backend: DataPort | null | undefined,
  workspacePath: string | null | undefined,
  pos: number | null | undefined,
  options?: Omit<
    UseQueryOptions<AlignState | null, Error, AlignState | null, readonly unknown[]>,
    "queryKey" | "queryFn" | "initialData"
  >,
) {
  const canQuery =
    !!backend && !!workspacePath && pos != null && !Number.isNaN(pos);
  return useQuery(
    enabledQueryOptions(
      canQuery ? alignStateQueryOptions(backend, workspacePath, pos) : null,
      options,
    ),
  );
}

export function useAutoExcludePreviewQuery(
  backend: DataPort | null | undefined,
  request: AutoExcludePreviewRequest | null | undefined,
  options?: Omit<
    UseQueryOptions<AutoExcludePreviewResponse, Error, AutoExcludePreviewResponse, readonly unknown[]>,
    "queryKey" | "queryFn" | "initialData"
  >,
) {
  return useQuery({
    ...enabledQueryOptions(
      backend && request ? autoExcludePreviewQueryOptions(backend, request) : null,
      options,
    ),
    staleTime: options?.staleTime ?? 0,
  });
}

// --- Mutations ---

function requireBackend(backend: DataPort | null | undefined): DataPort {
  if (!backend) {
    throw new Error("Data backend is not available");
  }
  return backend;
}

export function useSaveBboxMutation(
  backend: DataPort | null | undefined,
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
      requireBackend(backend).saveBbox(workspacePath, source, pos, csv, alignState),
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

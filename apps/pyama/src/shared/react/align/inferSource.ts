import type { ViewerSource } from "@/shared/contracts";

/** Infer ND2/CZI source from a path string. */
export function inferSourceFromDataPath(path: string): ViewerSource | null {
  const normalized = path.trim();
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  if (lower.endsWith(".nd2")) return { kind: "nd2", path: normalized };
  if (lower.endsWith(".czi")) return { kind: "czi", path: normalized };
  return null;
}

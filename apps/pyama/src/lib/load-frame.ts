import type {
  ContrastWindow,
  FrameResult,
  HostApi,
  Selection,
  Source,
} from "@/lib/contracts";
import { clamp, getFrameContrastDomain } from "@/lib/core";
import type { ContrastMode } from "@/lib/store";

function contrastWindowForFrame(frame: FrameResult | null): ContrastWindow {
  if (!frame) return { min: 0, max: 255 };
  return frame.contrastDomain ?? getFrameContrastDomain(frame);
}

export async function loadFrameWithContrast(
  api: HostApi,
  source: Source,
  selection: Selection,
  contrast: {
    mode: ContrastMode;
    min: number;
    max: number;
  },
): Promise<{
  frame: FrameResult;
  contrastMin: number;
  contrastMax: number;
}> {
  const requestedContrast =
    contrast.mode === "manual"
      ? ({
          min: contrast.min,
          max: contrast.max,
        } satisfies ContrastWindow)
      : undefined;

  try {
    const frame = await api.loadFrame(
      source,
      selection,
      requestedContrast ? { contrast: requestedContrast } : undefined,
    );
    const domain = contrastWindowForFrame(frame);
    const applied = frame.appliedContrast ?? frame.suggestedContrast ?? domain;

    return {
      frame,
      contrastMin: clamp(
        Math.round(applied.min),
        domain.min,
        Math.max(domain.min, domain.max - 1),
      ),
      contrastMax: clamp(
        Math.round(applied.max),
        Math.min(domain.min + 1, domain.max),
        domain.max,
      ),
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string" &&
      (error as { message: string }).message.length > 0
    ) {
      throw new Error((error as { message: string }).message);
    }
    throw new Error(
      typeof error === "string" && error.length > 0 ? error : "Failed to load frame",
    );
  }
}

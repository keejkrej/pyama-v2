import { useEffect } from "react";
import type { MutableRefObject } from "react";

import type { HostApi, Selection, Source } from "@/lib/contracts";
import { makeFrameKey } from "@/lib/core";
import type { FrameCache } from "@/lib/frame-cache";
import { loadFrameWithContrast } from "@/lib/load-frame";
import { toErrorMessage } from "@/lib/errors";
import type { ContrastMode } from "@/lib/store";
import { patchViewState } from "@/lib/store";

import { contrastWindowForFrame, normalizeContrastWindow } from "./frame-contrast";

export interface UseSourceFrameLoadArgs {
  api: HostApi | null;
  source: Source | null;
  selection: Selection | null;
  contrastMode: ContrastMode;
  contrastMin: number;
  contrastMax: number;
  /** Include auto token or manual min:max so effect re-runs when contrast inputs change. */
  contrastRequestKey: string;
  /**
   * When set, consult and populate this cache (workspace).
   * Optional for simpler loaders.
   */
  frameCacheRef?: MutableRefObject<Pick<FrameCache, "get" | "set">>;
}

/**
 * Loads the main canvas frame via {@link loadFrameWithContrast}, wiring loading/error and optional
 * in-memory frame cache (workspace only).
 */
export function useSourceFrameLoad({
  api,
  source,
  selection,
  contrastMode,
  contrastMin,
  contrastMax,
  contrastRequestKey,
  frameCacheRef,
}: UseSourceFrameLoadArgs) {
  useEffect(() => {
    if (!api || !source || !selection) return;

    const frameKey = makeFrameKey(source, selection);
    const cacheKey = `${frameKey}:${contrastRequestKey}`;

    if (frameCacheRef) {
      const cached = frameCacheRef.current.get(cacheKey);
      if (cached) {
        const domain = contrastWindowForFrame(cached.frame);
        const applied = cached.frame.appliedContrast ?? cached.frame.suggestedContrast ?? domain;
        const nextContrast = normalizeContrastWindow(applied, domain);
        patchViewState({ error: null });
        patchViewState({
          contrastMin: nextContrast.min,
          contrastMax: nextContrast.max,
          contrastMode: "manual",
          frame: cached.frame,
        });
        return;
      }
    }

    let cancelled = false;
    patchViewState({ loading: true, error: null });

    void (async () => {
      try {
        const { frame: loadedFrame, contrastMin: cmin, contrastMax: cmax } =
          await loadFrameWithContrast(api, source, selection, {
            mode: contrastMode,
            min: contrastMin,
            max: contrastMax,
          });

        if (cancelled) return;

        if (frameCacheRef) {
          frameCacheRef.current.set(cacheKey, { frame: loadedFrame });
          if (contrastMode === "auto") {
            frameCacheRef.current.set(`${frameKey}:${cmin}:${cmax}`, {
              frame: loadedFrame,
            });
          }
        }

        patchViewState({
          contrastMin: cmin,
          contrastMax: cmax,
          contrastMode: "manual",
          frame: loadedFrame,
        });
      } catch (error) {
        if (cancelled) return;
        patchViewState({
          error: toErrorMessage(error),
          frame: null,
        });
      } finally {
        if (!cancelled) {
          patchViewState({ loading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    api,
    contrastMax,
    contrastMin,
    contrastMode,
    contrastRequestKey,
    frameCacheRef,
    selection,
    source,
  ]);
}

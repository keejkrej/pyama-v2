import { Effect, Exit } from "effect";
import { useEffect } from "react";
import type { MutableRefObject } from "react";

import type { FrameResult, DataPort, Selection, Source } from "@/lib/contracts";

/** LRU or plain cache used by the workspace (see `FrameCache` in Workspace). */
export interface FrameResultCache {
  get(key: string): { frame: FrameResult } | undefined;
  set(key: string, value: { frame: FrameResult }): void;
}
import { makeFrameKey } from "@/lib/core";

import { loadFrameEffect } from "@/lib/effects";
import { toErrorMessage } from "@/lib/errors";
import type { ContrastMode } from "@/lib/store";
import { patchViewState } from "@/lib/store";

import { contrastWindowForFrame, normalizeContrastWindow } from "./frameContrast";

export interface UseSourceFrameLoadArgs {
  backend: DataPort | null;
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
  frameCacheRef?: MutableRefObject<FrameResultCache>;
}

/**
 * Loads the main canvas frame via {@link loadFrameEffect}, wiring loading/error and optional
 * in-memory frame cache (workspace only).
 */
export function useSourceFrameLoad({
  backend,
  source,
  selection,
  contrastMode,
  contrastMin,
  contrastMax,
  contrastRequestKey,
  frameCacheRef,
}: UseSourceFrameLoadArgs) {
  useEffect(() => {
    if (!backend || !source || !selection) return;

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

    const abortController = new AbortController();
    patchViewState({ loading: true, error: null });

    const program = loadFrameEffect(backend, source, selection, {
      mode: contrastMode,
      min: contrastMin,
      max: contrastMax,
    }).pipe(
      Effect.tap(({ frame: loadedFrame }) =>
        Effect.sync(() => {
          if (frameCacheRef) {
            frameCacheRef.current.set(cacheKey, { frame: loadedFrame });
          }
        }),
      ),
      Effect.tap(({ frame: loadedFrame, contrastMin: cmin, contrastMax: cmax }) =>
        Effect.sync(() => {
          if (frameCacheRef && contrastMode === "auto") {
            frameCacheRef.current.set(`${frameKey}:${cmin}:${cmax}`, {
              frame: loadedFrame,
            });
          }
          patchViewState({
            contrastMin: cmin,
            contrastMax: cmax,
            contrastMode: "manual",
            frame: loadedFrame,
          });
        }),
      ),
      Effect.catchAll((error) =>
        Effect.sync(() => {
          patchViewState({
            error: toErrorMessage(error),
            frame: null,
          });
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          patchViewState({ loading: false });
        }),
      ),
    );

    void Effect.runPromiseExit(program, {
      signal: abortController.signal,
    }).then((exit) => {
      if (!Exit.isFailure(exit)) return;
      if (abortController.signal.aborted) return;
      patchViewState({
        error: toErrorMessage(exit.cause),
        frame: null,
      });
    });

    return () => {
      abortController.abort();
    };
  }, [
    backend,
    contrastMax,
    contrastMin,
    contrastMode,
    contrastRequestKey,
    frameCacheRef,
    selection,
    source,
  ]);
}

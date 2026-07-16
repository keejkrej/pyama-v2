import { useEffect, useMemo, useState } from "react";

import type { ContrastWindow, FrameResult } from "@/lib/contracts";
import { clamp } from "@/lib/core";
import { AppSlider } from "@/components/Controls";
import { SidebarField, SidebarSection } from "@/components/sidebar";
import { Button } from "@/components/ui";
import { contrastWindowForFrame } from "@/hooks/frameContrast";
import { patchViewState, reloadAutoContrast } from "@/lib/store";

export interface IntensitySidebarProps {
  frame: FrameResult | null;
  contrastMin: number;
  contrastMax: number;
}

export function IntensitySidebar({ frame, contrastMin, contrastMax }: IntensitySidebarProps) {
  const contrastDomain = useMemo(() => contrastWindowForFrame(frame), [frame]);
  const contrastMinSliderMax = Math.max(contrastDomain.min + 1, contrastDomain.max) - 1;
  const contrastMaxSliderMin = Math.min(contrastDomain.max - 1, contrastDomain.min + 1);
  const [contrastDraft, setContrastDraft] = useState<ContrastWindow | null>(null);

  useEffect(() => {
    setContrastDraft({
      min: contrastMin,
      max: contrastMax,
    });
  }, [contrastMax, contrastMin]);

  const displayedContrast = contrastDraft ?? {
    min: contrastMin,
    max: contrastMax,
  };

  return (
    <SidebarSection
      title="Intensity"
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={!frame}
          className="h-7 px-2.5 text-xs"
          onClick={reloadAutoContrast}
        >
          Auto Range
        </Button>
      }
    >
      <SidebarField label="Min Intensity" hint={String(displayedContrast.min)}>
        <AppSlider
          value={displayedContrast.min}
          min={contrastDomain.min}
          max={contrastMinSliderMax}
          step={1}
          disabled={!frame}
          onChange={(value) => {
            setContrastDraft((current) => ({
              min: clamp(
                Math.round(value),
                contrastDomain.min,
                Math.min(contrastMinSliderMax, (current ?? displayedContrast).max - 1),
              ),
              max: (current ?? displayedContrast).max,
            }));
          }}
          onCommit={(value) => {
            patchViewState({
              contrastMode: "manual",
              contrastMin: clamp(
                Math.round(value),
                contrastDomain.min,
                Math.min(contrastMinSliderMax, displayedContrast.max - 1),
              ),
            });
          }}
        />
      </SidebarField>
      <SidebarField label="Max Intensity" hint={String(displayedContrast.max)}>
        <AppSlider
          value={displayedContrast.max}
          min={contrastMaxSliderMin}
          max={contrastDomain.max}
          step={1}
          disabled={!frame}
          onChange={(value) => {
            setContrastDraft((current) => ({
              min: (current ?? displayedContrast).min,
              max: clamp(
                Math.round(value),
                Math.max(contrastMaxSliderMin, (current ?? displayedContrast).min + 1),
                contrastDomain.max,
              ),
            }));
          }}
          onCommit={(value) => {
            patchViewState({
              contrastMode: "manual",
              contrastMax: clamp(
                Math.round(value),
                Math.max(contrastMaxSliderMin, displayedContrast.min + 1),
                contrastDomain.max,
              ),
            });
          }}
        />
      </SidebarField>
    </SidebarSection>
  );
}

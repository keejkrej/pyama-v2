import { useMemo } from "react";

import {
  clamp,
  degreesToRadians,
  radiansToDegrees,
  type GridShape,
  type GridState,
} from "@/lib/core";
import {
  AppSelect,
  AppSlider,
  NumberInput,
  type SelectOption,
} from "@/components/controls";
import {
  SidebarField,
  SidebarSection,
} from "@/components/sidebar";
import { Button } from "@/components/ui";
import { resetGrid, setGrid } from "@/lib/store";

export interface GridSidebarProps {
  grid: GridState;
  disabled: boolean;
}

export function GridSidebar({ grid, disabled }: GridSidebarProps) {
  const gridDegrees = radiansToDegrees(grid.rotation);
  const minGridSpacing = Math.min(grid.patternW, grid.patternH);
  const shapeOptions = useMemo<SelectOption<GridShape>[]>(
    () => [
      { label: "Square", value: "square" },
      { label: "Hex", value: "hex" },
    ],
    [],
  );

  return (
    <SidebarSection
      title="Grid"
      action={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs"
            disabled={disabled}
            aria-pressed={!grid.enabled}
            data-pressed={!grid.enabled ? "" : undefined}
            onClick={() =>
              setGrid((current) => ({ ...current, enabled: !current.enabled }))
            }
          >
            Hide
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs"
            disabled={disabled}
            onClick={resetGrid}
          >
            Reset
          </Button>
        </div>
      }
    >
      <SidebarField label="Grid Shape">
        <AppSelect
          value={grid.shape}
          options={shapeOptions}
          disabled={disabled}
          onChange={(value) => setGrid((current) => ({ ...current, shape: value }))}
        />
      </SidebarField>

      <SidebarField label="Rotation" hint={`${gridDegrees.toFixed(1)}°`}>
        <AppSlider
          value={gridDegrees}
          min={-180}
          max={180}
          step={0.1}
          disabled={disabled}
          onChange={(value) =>
            setGrid((current) => ({
              ...current,
              rotation: degreesToRadians(value),
            }))
          }
        />
      </SidebarField>

      <div className="grid grid-cols-2 gap-2">
        <SidebarField label="Spacing X">
          <NumberInput
            value={grid.spacingX}
            min={minGridSpacing}
            disabled={disabled}
            onChange={(value) =>
              setGrid((current) => ({
                ...current,
                spacingX: Number.isFinite(value) && value > 0 ? value : 1,
              }))
            }
          />
        </SidebarField>
        <SidebarField label="Spacing Y">
          <NumberInput
            value={grid.spacingY}
            min={minGridSpacing}
            disabled={disabled}
            onChange={(value) =>
              setGrid((current) => ({
                ...current,
                spacingY: Number.isFinite(value) && value > 0 ? value : 1,
              }))
            }
          />
        </SidebarField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SidebarField label="Pattern W">
          <NumberInput
            value={grid.patternW}
            disabled={disabled}
            onChange={(value) =>
              setGrid((current) => ({
                ...current,
                patternW: Number.isFinite(value) && value > 0 ? value : 1,
              }))
            }
          />
        </SidebarField>
        <SidebarField label="Pattern H">
          <NumberInput
            value={grid.patternH}
            disabled={disabled}
            onChange={(value) =>
              setGrid((current) => ({
                ...current,
                patternH: Number.isFinite(value) && value > 0 ? value : 1,
              }))
            }
          />
        </SidebarField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SidebarField label="Offset X">
          <NumberInput
            value={grid.tx}
            disabled={disabled}
            step="0.1"
            onChange={(value) =>
              setGrid((current) => ({ ...current, tx: Number.isFinite(value) ? value : 0 }))
            }
          />
        </SidebarField>
        <SidebarField label="Offset Y">
          <NumberInput
            value={grid.ty}
            disabled={disabled}
            step="0.1"
            onChange={(value) =>
              setGrid((current) => ({ ...current, ty: Number.isFinite(value) ? value : 0 }))
            }
          />
        </SidebarField>
      </div>

      <SidebarField label="Opacity" hint={grid.opacity.toFixed(2)}>
        <AppSlider
          value={grid.opacity}
          min={0}
          max={1}
          step={0.01}
          disabled={disabled}
          onChange={(value) =>
            setGrid((current) => ({ ...current, opacity: clamp(value, 0, 1) }))
          }
        />
      </SidebarField>
    </SidebarSection>
  );
}

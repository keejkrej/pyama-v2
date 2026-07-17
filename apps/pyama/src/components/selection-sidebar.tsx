import { Button } from "@/components/ui";
import {
  SidebarField,
  SidebarSection,
  SidebarSegmentedToggle,
  SidebarStat,
} from "@/components/sidebar";
import { setSelectionMode } from "@/lib/store";

export interface SelectionSidebarProps {
  disabled: boolean;
  frameReady: boolean;
  gridEnabled: boolean;
  selectionMode: boolean;
  includedVisibleCount: number;
  excludedVisibleCount: number;
  canResetExcludedCells: boolean;
  canExcludeAllVisibleCells: boolean;
  canExcludeEdge: boolean;
  canOpenAutoExclude: boolean;
  onResetExcluded: () => void;
  onExcludeAll: () => void;
  onExcludeEdge: () => void;
  onOpenAutoExclude: () => void;
}

export function SelectionSidebar({
  disabled,
  frameReady,
  gridEnabled,
  selectionMode,
  includedVisibleCount,
  excludedVisibleCount,
  canResetExcludedCells,
  canExcludeAllVisibleCells,
  canExcludeEdge,
  canOpenAutoExclude,
  onResetExcluded,
  onExcludeAll,
  onExcludeEdge,
  onOpenAutoExclude,
}: SelectionSidebarProps) {
  return (
    <SidebarSection title="Selection">
      <SidebarField label="Mode">
        <SidebarSegmentedToggle
          value={selectionMode ? "edit" : "view"}
          options={[
            { label: "View", value: "view" },
            { label: "Edit", value: "edit" },
          ]}
          compact
          disabled={disabled || !frameReady || !gridEnabled}
          onChange={(value) => setSelectionMode(value === "edit")}
        />
      </SidebarField>
      <div className="grid grid-cols-2 gap-2">
        <SidebarField label="Included Cells">
          <SidebarStat value={includedVisibleCount} />
        </SidebarField>
        <SidebarField label="Excluded Cells">
          <SidebarStat value={excludedVisibleCount} />
        </SidebarField>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 justify-center px-3 text-xs"
          disabled={!canResetExcludedCells}
          onClick={onResetExcluded}
        >
          Reset Excluded
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 justify-center px-3 text-xs"
          disabled={!canExcludeAllVisibleCells}
          onClick={onExcludeAll}
        >
          Exclude All
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 justify-center px-3 text-xs"
          disabled={!canExcludeEdge}
          onClick={onExcludeEdge}
        >
          Exclude Edge
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 justify-center px-3 text-xs"
          disabled={!canOpenAutoExclude}
          onClick={onOpenAutoExclude}
        >
          Auto Exclude
        </Button>
      </div>
    </SidebarSection>
  );
}

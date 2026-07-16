import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback } from "react";

import type {
  AutoExcludeHistogramBin,
  AutoExcludePreviewResponse,
} from "@/lib/contracts";
import {
  AUTO_EXCLUDE_CHART_MARGIN,
  AUTO_EXCLUDE_X_AXIS_HEIGHT,
  AUTO_EXCLUDE_Y_AXIS_WIDTH,
  clampThresholdToDomain,
  formatScore,
  scoreDomainForPreview,
  type AutoExcludeDomain,
  type AutoExcludeHistogramDatum,
} from "@/components/AutoExclude";
import { NumberInput } from "@/components/Controls";
import { SidebarField } from "@/components/sidebar";
import { Button } from "@/components/ui";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface AutoExcludeDialogProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  preview: AutoExcludePreviewResponse | null;
  threshold: number;
  selectionCount: number;
  canApply: boolean;
  onThresholdChange: (value: number) => void;
  onClose: () => void;
  onApply: () => void;
}

export function AutoExcludeDialog({
  open,
  loading,
  error,
  preview,
  threshold,
  selectionCount,
  canApply,
  onThresholdChange,
  onClose,
  onApply,
}: AutoExcludeDialogProps) {
  const domain = scoreDomainForPreview(preview);
  const histogramData: AutoExcludeHistogramDatum[] = (preview?.histogramBins ?? []).map(
    (bin: AutoExcludeHistogramBin) => ({
      x: (bin.start + bin.end) / 2,
      start: bin.start,
      end: bin.end,
      count: bin.count,
    }),
  );

  const updateThresholdFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, nextDomain: AutoExcludeDomain) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const relativeX = (event.clientX - rect.left) / Math.max(rect.width, 1);
      const nextThreshold =
        nextDomain.min + Math.min(1, Math.max(0, relativeX)) * (nextDomain.max - nextDomain.min);
      onThresholdChange(clampThresholdToDomain(nextThreshold, nextDomain));
    },
    [onThresholdChange],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      updateThresholdFromPointer(event, domain);
    },
    [domain, updateThresholdFromPointer],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      updateThresholdFromPointer(event, domain);
    },
    [domain, updateThresholdFromPointer],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      updateThresholdFromPointer(event, domain);
    },
    [domain, updateThresholdFromPointer],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-2xl rounded-[1.5rem] border border-border/80 bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-exclude-title"
      >
        <div className="border-b border-border px-5 py-4">
          <div className="space-y-1">
            <h2 id="auto-exclude-title" className="text-base font-medium text-foreground">
              Auto Exclude
            </h2>
            <p className="text-sm text-muted-foreground">
              Exclude visible included cells at or below the flatness threshold.
            </p>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <div>
                {preview?.eligibleCellCount ?? 0} eligible, {selectionCount} at threshold
              </div>
              <div>threshold {formatScore(threshold)}</div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Flatness histogram
              </p>
              <div className="text-xs text-muted-foreground">
                {formatScore(domain.min)} to {formatScore(domain.max)}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-background/45 p-3">
              {loading ? (
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                  Computing preview...
                </div>
              ) : error ? (
                <div className="flex h-64 items-center justify-center text-sm text-rose-200">
                  {error}
                </div>
              ) : preview && histogramData.length > 0 ? (
                <div className="relative h-64 w-full select-none">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histogramData} margin={AUTO_EXCLUDE_CHART_MARGIN}>
                      <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" vertical={false} />
                      <XAxis
                        type="number"
                        dataKey="x"
                        domain={[domain.min, domain.max]}
                        tick={{ fill: "rgba(148, 163, 184, 0.85)", fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: "rgba(148, 163, 184, 0.18)" }}
                        tickFormatter={(value: number) => formatScore(value)}
                      />
                      <YAxis
                        allowDecimals={false}
                        width={AUTO_EXCLUDE_Y_AXIS_WIDTH}
                        tick={{ fill: "rgba(148, 163, 184, 0.85)", fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: "rgba(148, 163, 184, 0.18)" }}
                      />
                      <Tooltip
                        cursor={false}
                        contentStyle={{
                          background: "rgba(12, 16, 25, 0.96)",
                          border: "1px solid rgba(148, 163, 184, 0.2)",
                          borderRadius: "12px",
                          color: "rgb(226, 232, 240)",
                        }}
                        formatter={(value: number) => [value, "Count"]}
                        labelFormatter={(_label, payload) => {
                          const datum = payload?.[0]?.payload as AutoExcludeHistogramDatum | undefined;
                          return datum
                            ? `${formatScore(datum.start)} - ${formatScore(datum.end)}`
                            : "Flatness";
                        }}
                      />
                      <ReferenceLine x={threshold} stroke="rgb(252, 165, 165)" strokeWidth={2} />
                      <Bar
                        dataKey="count"
                        fill="rgba(125, 211, 252, 0.85)"
                        stroke="rgba(125, 211, 252, 1)"
                        strokeWidth={1}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  <div
                    className="absolute touch-none"
                    style={{
                      top: `${AUTO_EXCLUDE_CHART_MARGIN.top}px`,
                      right: `${AUTO_EXCLUDE_CHART_MARGIN.right}px`,
                      bottom: `${AUTO_EXCLUDE_CHART_MARGIN.bottom + AUTO_EXCLUDE_X_AXIS_HEIGHT}px`,
                      left: `${AUTO_EXCLUDE_CHART_MARGIN.left + AUTO_EXCLUDE_Y_AXIS_WIDTH}px`,
                    }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  />
                </div>
              ) : (
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                  No visible included cells are eligible for auto exclude.
                </div>
              )}
            </div>
          </div>

          <SidebarField label="Threshold">
            <NumberInput
              value={threshold}
              step="0.01"
              min={domain.min}
              disabled={loading || !preview}
              onChange={(value) => onThresholdChange(clampThresholdToDomain(value, domain))}
            />
          </SidebarField>

          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-9 px-3 text-xs"
              disabled={loading}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button size="sm" className="h-9 px-3 text-xs" disabled={!canApply} onClick={onApply}>
              Auto Exclude
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

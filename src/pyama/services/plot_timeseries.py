from __future__ import annotations

import math
from collections import defaultdict
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from pyama import core as paths
from pyama import core as plot_layout
from pyama.core import (
    load_timeseries_csv,
    parse_timeseries_path,
    trace_color_alpha_from_fluor_name,
)
from pyama.core.slide import SlideMapping
from pyama.services import auc
from pyama.services.sample_packs import sample_pack_dir, write_sample_traces_xlsx

SamplePanel = tuple[int, list[tuple[Path, pd.DataFrame]]]
# Per sample: (t_minutes, mean, median, q25, q75, trace_count)
SampleSummary = tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, int]


def run_plot_timeseries(
    *,
    workspace: Path,
    interval: float,
    mapping: SlideMapping,
    slide_channel_names: dict[int, str] | None = None,
) -> list[Path]:
    """Read analysis/ traces and write results/<sample>/ csv+xlsx + single-panel pngs."""
    if interval <= 0:
        raise ValueError(f"--interval must be > 0, got {interval}")
    workspace = workspace.resolve()
    analysis_dir = paths.require_analysis_dir(workspace)
    timeseries_csvs = paths.discover_timeseries_csvs(analysis_dir)
    labels = slide_channel_names or paths.slide_channel_labels(mapping)
    results_dir = paths.workspace_results_dir(workspace)
    written: list[Path] = []
    written.extend(write_sample_traces_xlsx(workspace, mapping))

    panels = [(csv_path, load_timeseries_csv(csv_path)) for csv_path in timeseries_csvs]
    sample_panels = group_panels_by_slide_channel(panels, mapping)
    traces_shared_ylim = pooled_column_ylim(sample_panels, "corrected")
    summary_shared_ylim = pooled_summary_ylim(
        sample_panels, y_column="corrected", interval=interval
    )
    area_shared_ylim = pooled_column_ylim(sample_panels, "area")
    for slide_channel, frames in sample_panels:
        sample_name = mapping[slide_channel].sample_name
        dest = sample_pack_dir(results_dir, sample_name)
        written.append(
            write_sample_traces_plot(
                frames,
                dest / "traces.png",
                y_column="corrected",
                y_label="corrected intensity",
                interval=interval,
                sample_label=sample_name,
                slide_channel=slide_channel,
                slide_channel_names=labels,
            )
        )
        written.append(
            write_sample_traces_plot(
                frames,
                dest / "traces_shared_y.png",
                y_column="corrected",
                y_label="corrected intensity",
                interval=interval,
                sample_label=sample_name,
                slide_channel=slide_channel,
                slide_channel_names=labels,
                ylim=traces_shared_ylim,
            )
        )
        written.append(
            write_sample_summary_plot(
                frames,
                dest / "traces_summary.png",
                y_column="corrected",
                y_label="corrected intensity",
                interval=interval,
                sample_label=sample_name,
                slide_channel=slide_channel,
                slide_channel_names=labels,
            )
        )
        written.append(
            write_sample_summary_plot(
                frames,
                dest / "traces_summary_shared_y.png",
                y_column="corrected",
                y_label="corrected intensity",
                interval=interval,
                sample_label=sample_name,
                slide_channel=slide_channel,
                slide_channel_names=labels,
                ylim=summary_shared_ylim,
            )
        )
        if all("area" in df.columns for _, df in frames):
            written.append(
                write_sample_traces_plot(
                    frames,
                    dest / "area.png",
                    y_column="area",
                    y_label="mask area",
                    interval=interval,
                    sample_label=sample_name,
                    slide_channel=slide_channel,
                    slide_channel_names=labels,
                )
            )
            written.append(
                write_sample_traces_plot(
                    frames,
                    dest / "area_shared_y.png",
                    y_column="area",
                    y_label="mask area",
                    interval=interval,
                    sample_label=sample_name,
                    slide_channel=slide_channel,
                    slide_channel_names=labels,
                    ylim=area_shared_ylim,
                )
            )
    return written


def group_panels_by_slide_channel(
    panels: list[tuple[Path, pd.DataFrame]],
    mapping: SlideMapping,
) -> list[SamplePanel]:
    grouped: dict[int, list[tuple[Path, pd.DataFrame]]] = defaultdict(list)
    for csv_path, df in panels:
        try:
            slide_channel = auc.parse_slide_channel(csv_path, mapping)
        except ValueError:
            continue
        position, _signal_channel = parse_timeseries_path(csv_path)
        panel_df = df if "pos" in df.columns else df.assign(pos=position)
        grouped[slide_channel].append((csv_path, panel_df))
    return [(slide_channel, grouped[slide_channel]) for slide_channel in sorted(grouped)]


def write_sample_traces_plot(
    frames: list[tuple[Path, pd.DataFrame]],
    output_plot: Path,
    *,
    y_column: str,
    y_label: str,
    interval: float,
    sample_label: str,
    slide_channel: int,
    slide_channel_names: dict[int, str],
    ylim: tuple[float, float] | None = None,
) -> Path:
    fig, ax = plt.subplots(figsize=plot_layout.FIGURE_SIZE_IN)
    trace_color, trace_alpha = trace_color_alpha_from_fluor_name(
        trace_naming_haystack(slide_channel, frames, slide_channel_names)
    )
    trace_count = 0
    values: list[np.ndarray] = []
    for _csv_path, df in frames:
        values.append(panel_values(df, y_column))
        trace_groups = df.groupby(trace_group_columns(df), sort=True, dropna=False)
        for _, roi_df in trace_groups:
            t_minutes = roi_df["t"].astype(float).to_numpy(dtype=float) * interval
            ax.plot(t_minutes, roi_df[y_column], color=trace_color, alpha=trace_alpha)
        trace_count += int(trace_groups.ngroups)
    ax.set_title(f"{sample_label} ({trace_count} traces)")
    ax.set_xlabel("time (min)")
    ax.set_ylabel(y_label)
    y_low, y_high = ylim if ylim is not None else percentile_ylim(
        np.concatenate(values) if values else np.array([])
    )
    ax.set_ylim(y_low, y_high)
    _save_figure(fig, output_plot)
    return output_plot


def write_sample_summary_plot(
    frames: list[tuple[Path, pd.DataFrame]],
    output_plot: Path,
    *,
    y_column: str,
    y_label: str,
    interval: float,
    sample_label: str,
    slide_channel: int,
    slide_channel_names: dict[int, str],
    ylim: tuple[float, float] | None = None,
) -> Path:
    fig, ax = plt.subplots(figsize=plot_layout.FIGURE_SIZE_IN)
    trace_color, _trace_alpha = trace_color_alpha_from_fluor_name(
        trace_naming_haystack(slide_channel, frames, slide_channel_names)
    )
    summary = sample_summary_curves(frames, y_column=y_column, interval=interval)
    if summary is None:
        ax.set_title(f"{sample_label} (0 traces)")
        ax.set_xlabel("time (min)")
        ax.set_ylabel(y_label)
        y_low, y_high = ylim if ylim is not None else summary_ylim(summary)
        ax.set_ylim(y_low, y_high)
        _save_figure(fig, output_plot)
        return output_plot

    t_minutes, mean, median, q25, q75, trace_count = summary
    ax.fill_between(t_minutes, q25, q75, color=trace_color, alpha=0.25, linewidth=0, label="IQR", zorder=1)
    ax.plot(t_minutes, median, color=trace_color, linestyle="-", linewidth=1.8, label="median", zorder=3)
    ax.plot(t_minutes, mean, color=trace_color, linestyle="--", linewidth=1.5, label="mean", zorder=2)
    ax.set_title(f"{sample_label} ({trace_count} traces)")
    ax.set_xlabel("time (min)")
    ax.set_ylabel(y_label)
    y_low, y_high = ylim if ylim is not None else summary_ylim(summary)
    ax.set_ylim(y_low, y_high)
    ax.legend(loc="best", frameon=False)
    _save_figure(fig, output_plot)
    return output_plot


def sample_summary_curves(
    frames: list[tuple[Path, pd.DataFrame]],
    *,
    y_column: str,
    interval: float,
) -> SampleSummary | None:
    """Align ROI traces on time and compute mean, median, and IQR."""
    series_list: list[pd.Series] = []
    for _, df in frames:
        if y_column not in df.columns or "t" not in df.columns:
            continue
        trace_groups = df.groupby(trace_group_columns(df), sort=True, dropna=False)
        for _, roi_df in trace_groups:
            t_minutes = roi_df["t"].astype(float).to_numpy(dtype=float) * interval
            y_values = roi_df[y_column].astype(float).to_numpy(dtype=float)
            finite = np.isfinite(t_minutes) & np.isfinite(y_values)
            if not np.any(finite):
                continue
            series = pd.Series(y_values[finite], index=t_minutes[finite])
            if series.index.has_duplicates:
                series = series.groupby(level=0).mean()
            series_list.append(series)
    if not series_list:
        return None

    aligned = pd.concat(series_list, axis=1).sort_index()
    t_minutes = aligned.index.to_numpy(dtype=float)
    mean = aligned.mean(axis=1, skipna=True).to_numpy(dtype=float)
    median = aligned.median(axis=1, skipna=True).to_numpy(dtype=float)
    q25 = aligned.quantile(0.25, axis=1, interpolation="linear").to_numpy(dtype=float)
    q75 = aligned.quantile(0.75, axis=1, interpolation="linear").to_numpy(dtype=float)
    return (t_minutes, mean, median, q25, q75, len(series_list))


def summary_ylim(summary: SampleSummary | None) -> tuple[float, float]:
    if summary is None:
        return (0.0, 1.0)
    _t, mean, median, q25, q75, _trace_count = summary
    values = np.concatenate([mean, median, q25, q75])
    return percentile_ylim(values)


def pooled_column_ylim(
    sample_panels: list[SamplePanel], y_column: str
) -> tuple[float, float]:
    values: list[np.ndarray] = []
    for _slide_channel, frames in sample_panels:
        for _csv_path, df in frames:
            if y_column not in df.columns:
                continue
            values.append(panel_values(df, y_column))
    return percentile_ylim(np.concatenate(values) if values else np.array([]))


def pooled_summary_ylim(
    sample_panels: list[SamplePanel],
    *,
    y_column: str,
    interval: float,
) -> tuple[float, float]:
    values: list[np.ndarray] = []
    for _slide_channel, frames in sample_panels:
        summary = sample_summary_curves(frames, y_column=y_column, interval=interval)
        if summary is None:
            continue
        _t, mean, median, q25, q75, _trace_count = summary
        values.append(np.concatenate([mean, median, q25, q75]))
    return percentile_ylim(np.concatenate(values) if values else np.array([]))


def panel_values(df: pd.DataFrame, column: str) -> np.ndarray:
    return df[column].astype(float).to_numpy(dtype=float)


def percentile_ylim(values: np.ndarray, *, percentile: float = 5) -> tuple[float, float]:
    arr = np.asarray(values, dtype=float)
    arr = arr[np.isfinite(arr)]
    if arr.size == 0:
        return (0.0, 1.0)
    if percentile == 0:
        low_f, high_f = float(arr.min()), float(arr.max())
    else:
        low, high = np.percentile(arr, [percentile, 100.0 - percentile])
        low_f, high_f = float(low), float(high)
    return expand_degenerate_ylim(low_f, high_f)


def expand_degenerate_ylim(low: float, high: float) -> tuple[float, float]:
    if not math.isfinite(low) or not math.isfinite(high):
        return (0.0, 1.0)
    if low < high:
        return (low, high)
    pad = 1.0 if low == 0 else abs(low) * 0.05
    return (low - pad, high + pad)


def subplot_grid(n_panels: int, columns: int = 3):
    """Traces-style subplot grid: ``ceil(n_panels / columns)`` by ``columns``."""
    if n_panels < 1:
        raise ValueError("Need at least one subplot panel")
    if columns < 1:
        raise ValueError("columns must be >= 1")
    rows = math.ceil(n_panels / columns)
    fig, axes = plt.subplots(rows, columns, squeeze=False, figsize=plot_layout.FIGURE_SIZE_IN)
    return fig, axes.flatten()


def subplot_title(
    slide_channel: int,
    trace_count: int | None = None,
    *,
    slide_channel_names: dict[int, str] | None = None,
) -> str:
    names = slide_channel_names or {}
    label = names.get(slide_channel, f"slide channel {slide_channel}")
    if trace_count is None:
        return label
    return f"{label} ({trace_count} traces)"


def trace_group_columns(df) -> list[str]:
    columns = ["roi"]
    if "pos" in df.columns:
        columns.insert(0, "pos")
    return columns


def trace_naming_haystack(
    slide_channel: int,
    frames: list[tuple[Path, pd.DataFrame]],
    slide_channel_names: dict[int, str],
) -> str:
    parts = [slide_channel_names.get(slide_channel, f"slide channel {slide_channel}")]
    parts.extend(csv_path.name for csv_path, _ in frames)
    return " ".join(parts)


def _save_figure(fig: plt.Figure, output_plot: Path) -> None:
    output_plot.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_plot, dpi=plot_layout.FIGURE_DPI, bbox_inches="tight")
    plt.close(fig)


def format_written_timeseries_plot_message(output_plot: Path) -> str:
    return f"Wrote plot: {output_plot}"

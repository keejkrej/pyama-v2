from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from pyama import core as paths
from pyama import core as plot_layout
from pyama.core import boxplot_tick_labels, boxplot_x_axis_label
from pyama.core.slide import SlideMapping
from pyama.services import auc
from pyama.services.plot_timeseries import percentile_ylim
from pyama.services.sample_packs import position_lookup, write_sample_table_xlsx


def run_plot_auc(
    *,
    workspace: Path,
    mapping: SlideMapping,
    slide_channel_names: dict[int, str] | None = None,
) -> list[Path]:
    """Write per-sample auc.csv/.xlsx and one cross-sample boxplot at results/ root."""
    workspace = workspace.resolve()
    df = auc.load_analysis_auc_table(workspace)
    labels = slide_channel_names or paths.slide_channel_labels(mapping)
    results_dir = paths.workspace_results_dir(workspace)
    written: list[Path] = []
    written.extend(write_sample_table_xlsx(workspace, mapping, kind="auc", df=df))

    plotted = assign_slide_channels(df, mapping)
    written.append(
        write_condition_boxplot(
            plotted,
            value_column="auc",
            ylabel="AUC",
            output_plot=results_dir / "auc.png",
            slide_channel_names=labels,
        )
    )
    return written


def assign_slide_channels(df: pd.DataFrame, mapping: SlideMapping) -> pd.DataFrame:
    lookup = position_lookup(mapping)
    slide_channels: list[int] = []
    keep_rows: list[bool] = []
    for pos in df["pos"].tolist():
        mapped = lookup.get(int(pos)) if pd.notna(pos) else None
        if mapped is None:
            keep_rows.append(False)
            slide_channels.append(-1)
            continue
        keep_rows.append(True)
        slide_channels.append(mapped[0])
    out = df.loc[keep_rows].copy()
    out["slide_channel"] = [sc for sc, keep in zip(slide_channels, keep_rows) if keep]
    return out


def write_condition_boxplot(
    df: pd.DataFrame,
    *,
    value_column: str,
    ylabel: str,
    output_plot: Path,
    slide_channel_names: dict[int, str],
) -> Path:
    """One box per sample; written once at results/ root (linear scale)."""
    parameter_df = df.dropna(subset=[value_column, "slide_channel"]).copy()
    parameter_df[value_column] = pd.to_numeric(parameter_df[value_column], errors="coerce")
    parameter_df = parameter_df.dropna(subset=[value_column])
    if parameter_df.empty:
        raise ValueError(f"No finite rows available to plot {ylabel!r}")

    slide_channels = sorted(int(channel) for channel in parameter_df["slide_channel"].unique().tolist())
    grouped_values = [
        parameter_df.loc[parameter_df["slide_channel"] == slide_channel, value_column].to_numpy(
            dtype=float
        )
        for slide_channel in slide_channels
    ]
    trace_counts = [int(values.size) for values in grouped_values]

    fig, ax = plt.subplots(figsize=plot_layout.FIGURE_SIZE_IN)
    ax.boxplot(
        grouped_values,
        tick_labels=boxplot_tick_labels(slide_channels, trace_counts, slide_channel_names),
    )
    ax.set_xlabel(boxplot_x_axis_label(slide_channel_names))
    ax.set_ylabel(ylabel)
    arrays = [values for values in grouped_values if values.size]
    y_low, y_high = percentile_ylim(np.concatenate(arrays) if arrays else np.array([]))
    ax.set_ylim(y_low, y_high)

    output_plot.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_plot, dpi=plot_layout.FIGURE_DPI, bbox_inches="tight")
    plt.close(fig)
    return output_plot


def format_written_auc_plot_messages(output_plots: list[Path]) -> list[str]:
    return [f"Wrote plot: {output_plot}" for output_plot in output_plots]


def format_written_auc_plot_message(output_plot: Path) -> str:
    return format_written_auc_plot_messages([output_plot])[0]

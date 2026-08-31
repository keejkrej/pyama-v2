from __future__ import annotations

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from pyama import core as paths
from pyama import core as plot_layout
from pyama.core import load_timeseries_csv, trace_color_alpha_from_fluor_name
from pyama.core.slide import SlideMapping
from pyama.services import fit, plot_auc, plot_timeseries
from pyama.services.sample_packs import position_lookup, sample_pack_dir, write_sample_table_xlsx

PLOTTED_PARAMETERS = (
    ("intensity_offset", "intensity offset"),
    ("protein_lifetime", "protein lifetime"),
    ("mrna_lifetime", "mRNA lifetime"),
    ("translation_onset", "translation onset"),
    ("expression_rate", "expression rate"),
)
FIT_TRACE_PARAMETERS = (
    "intensity_offset",
    "protein_decay_rate",
    "mrna_decay_rate",
    "translation_onset",
    "expression_amplitude",
)


def run_plot_fit(
    *,
    workspace: Path,
    interval: float,
    mapping: SlideMapping,
    slide_channel_names: dict[int, str] | None = None,
) -> list[Path]:
    """Read analysis/PosN/fit.csv and write results/<sample>/ fit.xlsx + pngs."""
    if interval <= 0:
        raise ValueError(f"--interval must be > 0, got {interval}")
    workspace = workspace.resolve()
    df = prepare_fit_table(fit.load_analysis_fit_table(workspace), mapping)
    labels = slide_channel_names or paths.slide_channel_labels(mapping)
    results_dir = paths.workspace_results_dir(workspace)
    written: list[Path] = []
    written.extend(write_sample_table_xlsx(workspace, mapping, kind="fit", df=df))

    analysis_csvs = paths.discover_timeseries_csvs(paths.require_analysis_dir(workspace))
    panels = [(csv_path, load_timeseries_csv(csv_path)) for csv_path in analysis_csvs]
    sample_panels = plot_timeseries.group_panels_by_slide_channel(panels, mapping)

    for slide_channel, entry in mapping.items():
        sample_df = df.loc[df["slide_channel"] == slide_channel].copy()
        if sample_df.empty:
            continue
        dest = sample_pack_dir(results_dir, entry.sample_name)
        label = labels.get(slide_channel, entry.sample_name)
        for parameter, parameter_label in PLOTTED_PARAMETERS:
            written.append(
                plot_auc.write_sample_boxplot(
                    sample_df[parameter].to_numpy(dtype=float),
                    sample_label=label,
                    ylabel=parameter_label,
                    output_plot=dest / f"{parameter}.png",
                    log_scale=False,
                )
            )
            if parameter == "expression_rate":
                written.append(
                    plot_auc.write_sample_boxplot(
                        sample_df[parameter].to_numpy(dtype=float),
                        sample_label=label,
                        ylabel=parameter_label,
                        output_plot=dest / "expression_rate_log.png",
                        log_scale=True,
                    )
                )
        written.append(
            write_expression_rate_vs_onset_scatter(
                sample_df,
                output_plot=dest / "expression_rate_vs_onset.png",
                sample_label=label,
            )
        )
        sample_frames = dict(sample_panels).get(slide_channel, [])
        if sample_frames:
            written.append(
                write_sample_fitted_traces(
                    sample_df,
                    sample_frames,
                    dest / "traces_fit.png",
                    interval=interval,
                    sample_label=label,
                    slide_channel=slide_channel,
                    slide_channel_names=labels,
                )
            )
    return written


def prepare_fit_table(df: pd.DataFrame, mapping: SlideMapping) -> pd.DataFrame:
    required = {"pos", "roi", "success", *FIT_TRACE_PARAMETERS}
    missing = required.difference(df.columns)
    if missing:
        raise ValueError(f"analysis fit tables are missing required columns: {sorted(missing)}")

    keep_columns = [column for column in ("pos", "roi", "success", *FIT_TRACE_PARAMETERS) if column in df.columns]
    df = df.loc[:, keep_columns].copy()
    df = df.dropna(subset=["pos"])
    if df.empty:
        raise ValueError("analysis fit tables have no rows with pos values")

    df["pos"] = pd.to_numeric(df["pos"], errors="coerce").astype("Int64")
    df["roi"] = pd.to_numeric(df["roi"], errors="coerce").astype("Int64")
    df["success"] = df["success"].astype(str).str.lower().eq("true")
    for parameter in FIT_TRACE_PARAMETERS:
        df[parameter] = pd.to_numeric(df[parameter], errors="coerce")
    if "protein_lifetime" not in df.columns:
        df["protein_lifetime"] = 1.0 / df["protein_decay_rate"]
    if "mrna_lifetime" not in df.columns:
        df["mrna_lifetime"] = 1.0 / df["mrna_decay_rate"]
    if "expression_rate" not in df.columns:
        df["expression_rate"] = df["expression_amplitude"] * (df["mrna_decay_rate"] - df["protein_decay_rate"])

    lookup = position_lookup(mapping)
    slide_channels: list[int] = []
    sample_names: list[str] = []
    keep_rows: list[bool] = []
    for pos in df["pos"].tolist():
        mapped = lookup.get(int(pos)) if pd.notna(pos) else None
        if mapped is None:
            keep_rows.append(False)
            slide_channels.append(-1)
            sample_names.append("")
            continue
        keep_rows.append(True)
        slide_channel, sample_name = mapped
        slide_channels.append(slide_channel)
        sample_names.append(sample_name)
    df = df.loc[keep_rows].copy()
    df["slide_channel"] = [sc for sc, keep in zip(slide_channels, keep_rows) if keep]
    df["sample"] = [name for name, keep in zip(sample_names, keep_rows) if keep]
    return df.sort_values(["slide_channel", "pos", "roi"]).reset_index(drop=True)


def pearson_r(x: np.ndarray, y: np.ndarray) -> float | None:
    if x.size != y.size or x.size < 2:
        return None
    if not np.isfinite(x).all() or not np.isfinite(y).all():
        return None
    if float(np.std(x, ddof=0)) == 0.0 or float(np.std(y, ddof=0)) == 0.0:
        return None
    r = float(np.corrcoef(x, y)[0, 1])
    if not math.isfinite(r):
        return None
    return r


def pearson_annotation(r: float | None, n: int) -> str:
    if r is None:
        return f"n = {n}"
    return f"r = {r:.2f}\nn = {n}"


def write_expression_rate_vs_onset_scatter(
    df: pd.DataFrame,
    *,
    output_plot: Path,
    sample_label: str,
) -> Path:
    scatter_df = df.loc[df["success"]].copy()
    finite = np.isfinite(scatter_df["expression_rate"]) & np.isfinite(scatter_df["translation_onset"])
    scatter_df = scatter_df.loc[finite].copy()
    if scatter_df.empty:
        raise ValueError(
            f"No successful finite rows available to plot expression rate vs translation onset for {sample_label!r}"
        )

    x = scatter_df["translation_onset"].to_numpy(dtype=float)
    y = scatter_df["expression_rate"].to_numpy(dtype=float)
    trace_color, _trace_alpha = trace_color_alpha_from_fluor_name(sample_label)
    fig, ax = plt.subplots(figsize=plot_layout.FIGURE_SIZE_IN)
    ax.scatter(x, y, color=trace_color, alpha=0.55, s=18)
    ax.set_title(sample_label)
    ax.set_xlabel("translation onset")
    ax.set_ylabel("expression rate")
    x_low, x_high = plot_timeseries.percentile_ylim(x)
    y_low, y_high = plot_timeseries.percentile_ylim(y)
    ax.set_xlim(x_low, x_high)
    ax.set_ylim(y_low, y_high)
    ax.annotate(
        pearson_annotation(pearson_r(x, y), int(x.size)),
        xy=(0.05, 0.95),
        xycoords="axes fraction",
        va="top",
        ha="left",
    )
    output_plot.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_plot, dpi=plot_layout.FIGURE_DPI, bbox_inches="tight")
    plt.close(fig)
    return output_plot


def fitted_trace_values(times_minutes: np.ndarray, fit_row: pd.Series) -> np.ndarray:
    intensity_offset = float(fit_row["intensity_offset"])
    protein_decay_rate = float(fit_row["protein_decay_rate"])
    mrna_decay_rate = float(fit_row["mrna_decay_rate"])
    translation_onset = float(fit_row["translation_onset"])
    expression_amplitude = float(fit_row["expression_amplitude"])
    dt = np.maximum(times_minutes - translation_onset, 0.0)
    predicted = intensity_offset + expression_amplitude * (
        np.exp(-protein_decay_rate * dt) - np.exp(-mrna_decay_rate * dt)
    )
    predicted[times_minutes < translation_onset] = intensity_offset
    return predicted


def write_sample_fitted_traces(
    fit_df: pd.DataFrame,
    frames: list[tuple[Path, pd.DataFrame]],
    output_plot: Path,
    *,
    interval: float,
    sample_label: str,
    slide_channel: int,
    slide_channel_names: dict[int, str],
) -> Path:
    fig, ax = plt.subplots(figsize=plot_layout.FIGURE_SIZE_IN)
    fit_lookup = (
        fit_df.loc[fit_df["success"]]
        .set_index(["slide_channel", "pos", "roi"], drop=False)
        .sort_index()
    )
    trace_color, trace_alpha = trace_color_alpha_from_fluor_name(
        plot_timeseries.trace_naming_haystack(slide_channel, frames, slide_channel_names)
    )
    matched_traces = 0
    sample_values: list[np.ndarray] = []
    for _csv_path, df in frames:
        sample_values.append(plot_timeseries.panel_values(df, "corrected"))
        trace_groups = df.groupby(plot_timeseries.trace_group_columns(df), sort=True, dropna=False)
        for group_key, trace_df in trace_groups:
            if not isinstance(group_key, tuple):
                group_key = (group_key,)
            group_values = dict(zip(plot_timeseries.trace_group_columns(df), group_key, strict=True))
            pos = int(group_values.get("pos", 0))
            roi = int(group_values["roi"])
            lookup_key = (slide_channel, pos, roi)
            if lookup_key not in fit_lookup.index:
                continue
            fit_row = fit_lookup.loc[lookup_key]
            times_minutes = trace_df["t"].astype(float).to_numpy(dtype=float) * interval
            predicted = fitted_trace_values(times_minutes, fit_row)
            ax.plot(times_minutes, predicted, color=trace_color, alpha=trace_alpha)
            matched_traces += 1

    if matched_traces == 0:
        plt.close(fig)
        raise ValueError(f"No successful fit rows matched analysis traces for {sample_label!r}")

    ax.set_title(f"{sample_label} ({matched_traces} traces)")
    ax.set_xlabel("time (min)")
    ax.set_ylabel("corrected intensity")
    y_low, y_high = plot_timeseries.percentile_ylim(
        np.concatenate(sample_values) if sample_values else np.array([])
    )
    ax.set_ylim(y_low, y_high)
    output_plot.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_plot, dpi=plot_layout.FIGURE_DPI, bbox_inches="tight")
    plt.close(fig)
    return output_plot


def format_written_fit_plot_messages(output_plots: list[Path]) -> list[str]:
    return [f"Wrote plot: {output_plot}" for output_plot in output_plots]

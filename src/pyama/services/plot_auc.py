from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from pyama import core as paths
from pyama import core as plot_layout
from pyama.core.slide import SlideMapping
from pyama.services import auc
from pyama.services.plot_timeseries import percentile_ylim
from pyama.services.sample_packs import sample_pack_dir, write_sample_table_xlsx


def run_plot_auc(
    *,
    workspace: Path,
    mapping: SlideMapping,
    slide_channel_names: dict[int, str] | None = None,
) -> list[Path]:
    """Read analysis/PosN/auc.csv and write results/<sample>/ auc.xlsx + pngs."""
    workspace = workspace.resolve()
    df = auc.load_analysis_auc_table(workspace)
    labels = slide_channel_names or paths.slide_channel_labels(mapping)
    results_dir = paths.workspace_results_dir(workspace)
    written: list[Path] = []
    written.extend(write_sample_table_xlsx(workspace, mapping, kind="auc", df=df))

    lookup_positions = {
        slide_channel: set(entry.positions) for slide_channel, entry in mapping.items()
    }
    for slide_channel, entry in mapping.items():
        sample_df = df.loc[df["pos"].astype(int).isin(lookup_positions[slide_channel])].copy()
        if sample_df.empty:
            continue
        dest = sample_pack_dir(results_dir, entry.sample_name)
        label = labels.get(slide_channel, entry.sample_name)
        written.append(
            write_sample_boxplot(
                sample_df["auc"].to_numpy(dtype=float),
                sample_label=label,
                ylabel="AUC",
                output_plot=dest / "auc.png",
                log_scale=False,
            )
        )
 mar
        written.append(
            write_sample_boxplot(
                sample_df["auc"].to_numpy(dtype=float),
                sample_label=label,
                ylabel="AUC",
                output_plot=dest / "auc_log.png",
                log_scale=True,
            )
        )
    return written


def log_output_plot_path(output_plot: Path) -> Path:
    return output_plot.with_name(f"{output_plot.stem}_log{output_plot.suffix}")


def write_sample_boxplot(
    values: np.ndarray,
    *,
    sample_label: str,
    ylabel: str,
    output_plot: Path,
    log_scale: bool,
) -> Path:
    arr = np.asarray(values, dtype=float)
    arr = arr[np.isfinite(arr)]
    if log_scale:
        arr = arr[arr > 0]
    if arr.size == 0:
        raise ValueError(f"No finite rows available to plot {ylabel!r} for {sample_label!r}")

    fig, ax = plt.subplots(figsize=plot_layout.FIGURE_SIZE_IN)
    n = int(arr.size)
    ax.boxplot([arr], tick_labels=[f"{sample_label}\n(n={n})"])
    ax.set_xlabel("condition")
    ax.set_ylabel(ylabel)
    if log_scale:
        ax.set_yscale("log")
    else:
        y_low, y_high = percentile_ylim(arr)
        ax.set_ylim(y_low, y_high)

    output_plot.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_plot, dpi=plot_layout.FIGURE_DPI, bbox_inches="tight")
    plt.close(fig)
    return output_plot


def format_written_auc_plot_messages(output_plots: list[Path]) -> list[str]:
    return [f"Wrote plot: {output_plot}" for output_plot in output_plots]


def format_written_auc_plot_message(output_plot: Path) -> str:
    return format_written_auc_plot_messages([output_plot])[0]

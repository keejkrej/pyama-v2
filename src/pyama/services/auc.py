from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

from pyama import core as paths
from pyama.core import load_timeseries_csv
from pyama.core.export import parallel_xlsx_path, write_csv_and_parallel_xlsx
from pyama.core.slide import SlideMapping
from pyama.core.timeseries import resolve_slide_channel_from_path


GROUP_COLUMNS = ("pos", "roi")
OUTPUT_COLUMNS = ("slide_channel", "pos", "roi", "auc")

AucTraceTask = tuple[int, dict[str, int], list[float], list[float], float]


def default_results_table_csv_path(results_dir: Path, *, kind: str) -> Path:
    """Write ``auc.csv`` or ``fit.csv`` under ``results_dir``."""

    return (results_dir.resolve() / f"{kind}.csv").resolve()


def integrate_auc_csvs(
    timeseries_csvs: list[Path],
    *,
    interval: float,
    output_csv: Path | None,
    mapping: SlideMapping,
) -> Path:
    if interval <= 0:
        raise ValueError(f"--interval must be > 0, got {interval}")

    resolved_csvs = sorted((csv_path.resolve() for csv_path in timeseries_csvs), key=lambda path: path.name)
    auc_df = compute_auc_table(resolved_csvs, interval=interval, mapping=mapping)
    resolved_output_csv = default_output_csv_path(resolved_csvs, output_csv)
    write_auc_csv(auc_df, resolved_output_csv)
    return resolved_output_csv


def default_output_csv_path(
    timeseries_csvs: list[Path],
    output_csv: Path | None,
    *,
    results_dir: Path | None = None,
) -> Path:
    if output_csv is not None:
        return output_csv.resolve()
    if results_dir is not None:
        return default_results_table_csv_path(results_dir, kind="auc")
    return timeseries_csvs[0].with_name("auc.csv").resolve()


def parse_slide_channel(csv_path: Path, mapping: SlideMapping) -> int:
    return resolve_slide_channel_from_path(csv_path, mapping)


def integrate_series(t_values: list[float], corrected: list[float], *, interval: float) -> float:
    if len(t_values) < 2:
        return 0.0

    times = np.asarray(t_values, dtype=float) * interval
    values = np.asarray(corrected, dtype=float)
    order = np.argsort(times, kind="mergesort")
    times = times[order]
    values = values[order]
    widths = times[1:] - times[:-1]
    heights = (values[:-1] + values[1:]) * 0.5
    return float((widths * heights).sum())


def integrate_trace(trace_df: pd.DataFrame, *, interval: float) -> float:
    sorted_df = trace_df.sort_values("t").reset_index(drop=True)
    return integrate_series(
        sorted_df["t"].astype(float).tolist(),
        sorted_df["corrected"].astype(float).tolist(),
        interval=interval,
    )


def _auc_trace_task(task: AucTraceTask) -> dict[str, object]:
    slide_channel, group_values, t_values, corrected, interval = task
    return {
        "slide_channel": slide_channel,
        **group_values,
        "auc": integrate_series(t_values, corrected, interval=interval),
    }


def _run_auc_tasks(tasks: list[AucTraceTask]) -> list[dict[str, object]]:
    max_workers = max(1, min(len(tasks), os.cpu_count() or 1))
    if max_workers == 1:
        return [_auc_trace_task(task) for task in tasks]

    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        return list(executor.map(_auc_trace_task, tasks))


def compute_auc_table(
    timeseries_csvs: list[Path],
    *,
    interval: float,
    mapping: SlideMapping,
) -> pd.DataFrame:
    tasks: list[AucTraceTask] = []
    for csv_path in timeseries_csvs:
        df = load_timeseries_csv(csv_path)
        slide_channel = parse_slide_channel(csv_path, mapping)
        position, _signal_channel = paths.parse_timeseries_path(csv_path)
        if "pos" not in df.columns:
            df = df.assign(pos=position)
        if "roi" not in df.columns:
            raise ValueError(f"{csv_path} is missing required column: roi")

        for group_key, trace_df in df.groupby(["pos", "roi"], sort=True):
            if not isinstance(group_key, tuple):
                group_key = (group_key,)
            pos, roi = group_key
            sorted_df = trace_df.sort_values("t").reset_index(drop=True)
            tasks.append(
                (
                    slide_channel,
                    {"pos": int(pos), "roi": int(roi)},
                    sorted_df["t"].astype(float).tolist(),
                    sorted_df["corrected"].astype(float).tolist(),
                    interval,
                )
            )

    if not tasks:
        raise ValueError("No AUC rows produced")

    result = pd.DataFrame(_run_auc_tasks(tasks))
    sort_columns = [column for column in ("slide_channel", *GROUP_COLUMNS) if column in result.columns]
    return result.sort_values(sort_columns).reset_index(drop=True).loc[:, list(OUTPUT_COLUMNS)]


def write_auc_csv(df: pd.DataFrame, output_csv: Path) -> None:
    write_csv_and_parallel_xlsx(df, output_csv)


def format_written_auc_csv_message(output_csv: Path) -> str:
    output_xlsx = parallel_xlsx_path(output_csv)
    message = f"Wrote AUC CSV: {output_csv}"
    if output_xlsx.is_file():
        message += f"\nWrote AUC XLSX: {output_xlsx}"
    else:
        message += f"\nSkipped AUC XLSX (exceeds Excel row limit): {output_xlsx}"
    return message



def run_auc(*, workspace: Path, interval: float, mapping: SlideMapping) -> Path:
    """Integrate timeseries; ``mapping`` comes from the notebook Config cell (not assay.json)."""
    workspace = workspace.resolve()
    timeseries_csvs = paths.discover_timeseries_csvs(paths.workspace_timeseries_dir(workspace))
    results_dir = paths.workspace_results_dir(workspace)
    output_csv = default_output_csv_path(timeseries_csvs, None, results_dir=results_dir)
    return integrate_auc_csvs(timeseries_csvs, interval=interval, output_csv=output_csv, mapping=mapping)

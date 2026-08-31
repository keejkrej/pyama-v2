from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

from pyama import core as paths
from pyama.core import load_timeseries_csv
from pyama.core.export import write_csv
from pyama.core.slide import SlideMapping
from pyama.core.timeseries import resolve_slide_channel_from_path


GROUP_COLUMNS = ("pos", "roi")
OUTPUT_COLUMNS = ("pos", "roi", "auc")

AucTraceTask = tuple[dict[str, int], list[float], list[float], float]


def parse_slide_channel(csv_path: Path, mapping: SlideMapping) -> int:
    return resolve_slide_channel_from_path(csv_path, mapping)


def position_auc_csv_path(workspace: Path, position: int) -> Path:
    return (paths.workspace_analysis_dir(workspace) / f"Pos{position}" / "auc.csv").resolve()


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
    group_values, t_values, corrected, interval = task
    return {
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
) -> pd.DataFrame:
    tasks: list[AucTraceTask] = []
    for csv_path in timeseries_csvs:
        df = load_timeseries_csv(csv_path)
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
                    {"pos": int(pos), "roi": int(roi)},
                    sorted_df["t"].astype(float).tolist(),
                    sorted_df["corrected"].astype(float).tolist(),
                    interval,
                )
            )

    if not tasks:
        raise ValueError("No AUC rows produced")

    result = pd.DataFrame(_run_auc_tasks(tasks))
    sort_columns = [column for column in GROUP_COLUMNS if column in result.columns]
    return result.sort_values(sort_columns).reset_index(drop=True).loc[:, list(OUTPUT_COLUMNS)]


def write_position_auc_csvs(workspace: Path, df: pd.DataFrame) -> list[Path]:
    written: list[Path] = []
    for position, group in df.groupby("pos", sort=True):
        output_csv = position_auc_csv_path(workspace, int(position))
        write_csv(group.reset_index(drop=True).loc[:, list(OUTPUT_COLUMNS)], output_csv)
        written.append(output_csv)
    return written


def load_analysis_auc_table(workspace: Path) -> pd.DataFrame:
    analysis_dir = paths.require_analysis_dir(workspace)
    csvs = sorted(analysis_dir.glob("Pos*/auc.csv"), key=lambda path: path.parent.name)
    if not csvs:
        raise ValueError(f"No analysis/Pos*/auc.csv files in {analysis_dir}. Run AUC in analyze.ipynb first.")
    frames = [pd.read_csv(csv_path) for csv_path in csvs]
    df = pd.concat(frames, ignore_index=True)
    missing = {"pos", "roi", "auc"}.difference(df.columns)
    if missing:
        raise ValueError(f"analysis AUC tables are missing columns: {sorted(missing)}")
    df = df.dropna(subset=["pos", "auc"]).copy()
    df["pos"] = pd.to_numeric(df["pos"], errors="coerce").astype("Int64")
    df["roi"] = pd.to_numeric(df["roi"], errors="coerce").astype("Int64")
    df["auc"] = df["auc"].astype(float)
    return df.sort_values(["pos", "roi"]).reset_index(drop=True)


def write_auc_csv(df: pd.DataFrame, output_csv: Path) -> None:
    write_csv(df, output_csv)


def format_written_auc_csv_message(output_csv: Path) -> str:
    return f"Wrote AUC CSV: {output_csv}"


def run_auc(*, workspace: Path, interval: float) -> list[Path]:
    """Integrate analysis traces. Sample names are not used; writes analysis/PosN/auc.csv only."""
    if interval <= 0:
        raise ValueError(f"--interval must be > 0, got {interval}")
    workspace = workspace.resolve()
    timeseries_csvs = paths.discover_timeseries_csvs(paths.workspace_analysis_dir(workspace))
    auc_df = compute_auc_table(timeseries_csvs, interval=interval)
    return write_position_auc_csvs(workspace, auc_df)

from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import pandas as pd

from pyama.core import (
    compute_timeseries_metrics,
    discover_roi_positions,
    position_dir,
    read_position_index,
    validate_channel_index,
    write_metrics_csv,
    workspace_analysis_dir,
)

OUTPUT_COLUMNS = ("roi", "t", "area", "background", "sum", "corrected")
CsvWrittenCallback = Callable[[int, Path, int], None]


@dataclass(frozen=True)
class SlideTimeseriesRunResult:
    written_outputs: list[tuple[int, Path, int]]
    skipped_positions: list[int]


def default_position_timeseries_csv_path(
    workspace: Path,
    position: int,
    signal_channel: int,
) -> Path:
    csv_path = workspace_analysis_dir(workspace) / f"Pos{position}" / f"ch{signal_channel}.csv"
    return csv_path.resolve()


def simplify_metrics(df: pd.DataFrame) -> pd.DataFrame:
    return df.loc[:, list(OUTPUT_COLUMNS)].sort_values(["roi", "t"]).reset_index(drop=True)


def _run_position_metrics(
    workspace: Path,
    *,
    signal_channel: int,
    resolved_pos: int,
) -> tuple[int, int, pd.DataFrame | None]:
    try:
        pos_dir = position_dir(workspace, resolved_pos)
    except ValueError:
        return (signal_channel, resolved_pos, None)

    index = read_position_index(pos_dir)
    validate_channel_index(index, signal_channel)
    metrics_df = compute_timeseries_metrics(
        pos_dir,
        index,
        channel=signal_channel,
    )
    return (signal_channel, resolved_pos, metrics_df)


def _position_timeseries_task(
    payload: tuple[str, int, int],
) -> tuple[int, int, pd.DataFrame | None]:
    workspace_str, signal_channel, resolved_pos = payload
    return _run_position_metrics(
        Path(workspace_str),
        signal_channel=signal_channel,
        resolved_pos=resolved_pos,
    )


def _write_position_csv(
    workspace: Path,
    *,
    position: int,
    signal_channel: int,
    metrics_df: pd.DataFrame,
) -> tuple[Path, int]:
    resolved_output_csv = default_position_timeseries_csv_path(
        workspace=workspace,
        position=position,
        signal_channel=signal_channel,
    )
    write_metrics_csv(
        simplify_metrics(metrics_df),
        resolved_output_csv,
    )
    return (resolved_output_csv, len(metrics_df))


def run_slide_timeseries(
    workspace: Path,
    *,
    signal_channel: int,
    on_csv_written: CsvWrittenCallback | None = None,
) -> SlideTimeseriesRunResult:
    workspace = workspace.resolve()
    if not isinstance(signal_channel, int) or isinstance(signal_channel, bool) or signal_channel < 0:
        raise ValueError(f"SIGNAL_CHANNEL must be a non-negative integer, got {signal_channel!r}")
    positions = discover_roi_positions(workspace)
    if not positions:
        raise ValueError(f"No ROI directories found under {workspace / 'roi'}")

    position_tasks: list[tuple[str, int, int]] = [
        (str(workspace), signal_channel, resolved_pos) for resolved_pos in positions
    ]

    skipped_positions: list[int] = []
    written_outputs: list[tuple[int, Path, int]] = []

    def consume_result(
        _signal_channel: int,
        position: int,
        metrics_df: pd.DataFrame | None,
    ) -> None:
        if metrics_df is None:
            skipped_positions.append(position)
            return
        output_csv, row_count = _write_position_csv(
            workspace,
            position=position,
            signal_channel=signal_channel,
            metrics_df=metrics_df,
        )
        written_outputs.append((position, output_csv, row_count))
        if on_csv_written is not None:
            on_csv_written(position, output_csv, row_count)

    max_workers = max(1, min(len(position_tasks), os.cpu_count() or 1))
    if max_workers == 1:
        for ws_str, task_signal_channel, resolved_pos in position_tasks:
            consume_result(
                *_run_position_metrics(
                    Path(ws_str),
                    signal_channel=task_signal_channel,
                    resolved_pos=resolved_pos,
                )
            )
    else:
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(_position_timeseries_task, t) for t in position_tasks]
            for fut in as_completed(futures):
                consume_result(*fut.result())

    if not written_outputs:
        if skipped_positions:
            skipped_summary = ", ".join(str(pos) for pos in sorted(skipped_positions))
            raise ValueError(
                "No ROI directories found for discovered positions. "
                f"Skipped positions: {skipped_summary}"
            )
        raise ValueError(f"No ROI directories found under {workspace / 'roi'}")

    written_outputs.sort(key=lambda item: item[0])
    return SlideTimeseriesRunResult(
        written_outputs=written_outputs,
        skipped_positions=sorted(skipped_positions),
    )


def format_written_timeseries_csv_message(position: int, output_csv: Path, row_count: int) -> str:
    return f"Wrote metrics CSV for Pos{position} with {row_count} rows: {output_csv}"


def format_skipped_positions_message(skipped_positions: list[int]) -> str:
    skipped_summary = ", ".join(str(pos) for pos in skipped_positions)
    return (
        f"Skipped {len(skipped_positions)} missing positions from roi/: {skipped_summary}"
    )


def run_timeseries(
    *,
    workspace: Path,
    signal_channel: int,
    on_csv_written: CsvWrittenCallback | None = None,
) -> SlideTimeseriesRunResult:
    return run_slide_timeseries(
        workspace,
        signal_channel=signal_channel,
        on_csv_written=on_csv_written,
    )

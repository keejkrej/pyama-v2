from __future__ import annotations

import os
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import pandas as pd

from pyama.core import (
    SlideMapping,
    compute_timeseries_metrics,
    position_dir,
    read_position_index,
    validate_channel_index,
    validate_slide_mapping,
    write_metrics_csv,
)
from pyama.core.export import parallel_xlsx_path



OUTPUT_COLUMNS = ("roi", "t", "area", "background", "sum", "corrected")
CsvWrittenCallback = Callable[[int, Path, int], None]


@dataclass(frozen=True)
class SlideTimeseriesRunResult:
    written_outputs: list[tuple[int, Path, int]]
    skipped_positions: dict[int, list[int]]


load_slide_position_groups = validate_slide_mapping


def default_position_timeseries_csv_path(
    workspace: Path,
    position: int,
    signal_channel: int,
) -> Path:
    csv_path = workspace / "timeseries" / f"Pos{position}" / f"ch{signal_channel}.csv"
    return csv_path.resolve()


def simplify_metrics(df: pd.DataFrame) -> pd.DataFrame:
    return df.loc[:, list(OUTPUT_COLUMNS)].sort_values(["roi", "t"]).reset_index(drop=True)


def _run_position_metrics(
    workspace: Path,
    *,
    slide_channel: int,
    signal_channel: int,
    resolved_pos: int,
) -> tuple[int, int, int, pd.DataFrame | None]:
    try:
        pos_dir = position_dir(workspace, resolved_pos)
    except ValueError:
        return (slide_channel, signal_channel, resolved_pos, None)

    index = read_position_index(pos_dir)
    validate_channel_index(index, signal_channel)
    metrics_df = compute_timeseries_metrics(
        pos_dir,
        index,
        channel=signal_channel,
    )
    return (slide_channel, signal_channel, resolved_pos, metrics_df)


def _position_timeseries_task(
    payload: tuple[str, int, int, int],
) -> tuple[int, int, int, pd.DataFrame | None]:
    workspace_str, slide_channel, signal_channel, resolved_pos = payload
    return _run_position_metrics(
        Path(workspace_str),
        slide_channel=slide_channel,
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
    mapping: SlideMapping,
    on_csv_written: CsvWrittenCallback | None = None,
    jobs: int = 1,
) -> SlideTimeseriesRunResult:
    if jobs < 1:
        raise ValueError(f"jobs must be >= 1, got {jobs}")
    workspace = workspace.resolve()
    slide_positions = validate_slide_mapping(mapping)
    position_tasks: list[tuple[str, int, int, int]] = [
        (
            str(workspace),
            slide_channel,
            entry.signal_channel,
            resolved_pos,
        )
        for slide_channel, entry in slide_positions.items()
        for resolved_pos in entry.positions
    ]

    if not position_tasks:
        raise ValueError("Slide mapping defines no valid positions")

    skipped_positions: dict[int, list[int]] = defaultdict(list)
    rows: list[tuple[int, int, int, pd.DataFrame | None]] = []

    if jobs == 1 or len(position_tasks) <= 1:
        for ws_str, slide_channel, signal_channel, resolved_pos in position_tasks:
            rows.append(_run_position_metrics(
                Path(ws_str),
                slide_channel=slide_channel,
                signal_channel=signal_channel,
                resolved_pos=resolved_pos,
            ))
    else:
        max_workers = min(jobs, len(position_tasks), os.cpu_count() or jobs)
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(_position_timeseries_task, t) for t in position_tasks]
            for fut in as_completed(futures):
                rows.append(fut.result())

    written_outputs: list[tuple[int, Path, int]] = []
    signal_channels = {
        (slide_channel, position): entry.signal_channel
        for slide_channel, entry in slide_positions.items()
        for position in entry.positions
    }
    for slide_channel, _signal_channel, position, metrics_df in sorted(rows, key=lambda row: row[2]):
        if metrics_df is None:
            skipped_positions[slide_channel].append(position)
            continue
        output_csv, row_count = _write_position_csv(
            workspace,
            position=position,
            signal_channel=signal_channels[(slide_channel, position)],
            metrics_df=metrics_df,
        )
        written_outputs.append((position, output_csv, row_count))
        if on_csv_written is not None:
            on_csv_written(position, output_csv, row_count)

    if not written_outputs:
        if skipped_positions:
            skipped_summary = "; ".join(
                f"slide channel {slide_channel} -> {', '.join(str(pos) for pos in positions)}"
                for slide_channel, positions in sorted(skipped_positions.items())
            )
            raise ValueError(
                "No ROI directories found for positions in slide mapping. "
                f"Skipped positions: {skipped_summary}"
            )
        raise ValueError("Slide mapping defines no valid positions")

    return SlideTimeseriesRunResult(
        written_outputs=written_outputs,
        skipped_positions=skipped_positions,
    )


def format_written_timeseries_csv_message(position: int, output_csv: Path, row_count: int) -> str:
    output_xlsx = parallel_xlsx_path(output_csv)
    message = (
        f"Wrote metrics CSV for Pos{position} with {row_count} rows: "
        f"{output_csv}"
    )
    if output_xlsx.is_file():
        message += (
            f"\nWrote metrics XLSX for Pos{position} with {row_count} rows: "
            f"{output_xlsx}"
        )
    else:
        message += f"\nSkipped metrics XLSX (exceeds Excel row limit): {output_xlsx}"
    return message



def format_skipped_positions_message(skipped_positions: dict[int, list[int]]) -> str:
    total_skipped_positions = sum(len(positions) for positions in skipped_positions.values())
    skipped_summary = "; ".join(
        f"slide channel {slide_channel} -> {', '.join(str(pos) for pos in positions)}"
        for slide_channel, positions in sorted(skipped_positions.items())
    )
    return f"Skipped {total_skipped_positions} missing positions from slide mapping: {skipped_summary}"


def run_timeseries(
    *,
    workspace: Path,
    mapping: SlideMapping,
    on_csv_written: CsvWrittenCallback | None = None,
    jobs: int = 1,
) -> SlideTimeseriesRunResult:
    return run_slide_timeseries(
        workspace,
        mapping=mapping,
        on_csv_written=on_csv_written,
        jobs=jobs,
    )

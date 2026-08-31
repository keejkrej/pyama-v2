from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from pyama import core as paths
from pyama.core.export import write_xlsx
from pyama.core.slide import SlideMapping
from pyama.core.timeseries import parse_timeseries_path, resolve_slide_channel_from_path

TRACE_COLUMNS = (
    "slide_channel",
    "sample",
    "pos",
    "roi",
    "t",
    "area",
    "background",
    "sum",
    "corrected",
)
_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def filesystem_safe_sample_name(sample_name: str) -> str:
    cleaned = _UNSAFE_CHARS.sub("_", sample_name.strip()).strip("._")
    if not cleaned or cleaned in {".", ".."}:
        return "sample"
    return cleaned


def sample_pack_dir(results_dir: Path, sample_name: str) -> Path:
    return results_dir.resolve() / filesystem_safe_sample_name(sample_name)


def position_lookup(mapping: SlideMapping) -> dict[int, tuple[int, str]]:
    lookup: dict[int, tuple[int, str]] = {}
    for slide_channel, entry in mapping.items():
        for position in entry.positions:
            lookup[position] = (slide_channel, entry.sample_name)
    return lookup


def write_sample_traces_xlsx(workspace: Path, mapping: SlideMapping) -> list[Path]:
    """Write results/<sample>/traces.xlsx (no CSV)."""
    workspace = workspace.resolve()
    timeseries_csvs = paths.discover_timeseries_csvs(paths.workspace_analysis_dir(workspace))
    results_dir = paths.workspace_results_dir(workspace)
    frames_by_sample: dict[str, list[pd.DataFrame]] = {}
    for csv_path in timeseries_csvs:
        try:
            slide_channel = resolve_slide_channel_from_path(csv_path, mapping)
        except ValueError:
            continue
        sample_name = mapping[slide_channel].sample_name
        position, _signal_channel = parse_timeseries_path(csv_path)
        df = paths.load_timeseries_csv(csv_path)
        if "pos" not in df.columns:
            df = df.assign(pos=position)
        df = df.assign(slide_channel=slide_channel, sample=sample_name)
        missing = [column for column in TRACE_COLUMNS if column not in df.columns]
        if missing:
            raise ValueError(f"{csv_path} is missing required columns: {missing}")
        frames_by_sample.setdefault(sample_name, []).append(df.loc[:, list(TRACE_COLUMNS)])

    written: list[Path] = []
    for sample_name, frames in frames_by_sample.items():
        combined = pd.concat(frames, ignore_index=True)
        combined = combined.sort_values(["slide_channel", "pos", "roi", "t"]).reset_index(drop=True)
        written.extend(_write_sample_xlsx(sample_pack_dir(results_dir, sample_name), "traces", combined))
    return written


def write_sample_table_xlsx(
    workspace: Path,
    mapping: SlideMapping,
    *,
    kind: str,
    df: pd.DataFrame,
) -> list[Path]:
    """Write results/<sample>/{kind}.xlsx from an analysis table (no CSV)."""
    if "pos" not in df.columns:
        raise ValueError(f"{kind} table is missing required column: pos")
    results_dir = paths.workspace_results_dir(workspace)
    lookup = position_lookup(mapping)
    sample_frames: dict[str, list[pd.DataFrame]] = {}
    for position, group in df.groupby("pos", sort=True):
        mapped = lookup.get(int(position))
        if mapped is None:
            continue
        slide_channel, sample_name = mapped
        sample_df = group.copy()
        sample_df["slide_channel"] = slide_channel
        sample_df["sample"] = sample_name
        sample_frames.setdefault(sample_name, []).append(sample_df)

    written: list[Path] = []
    for sample_name, frames in sample_frames.items():
        combined = pd.concat(frames, ignore_index=True)
        sort_columns = [column for column in ("slide_channel", "pos", "roi") if column in combined.columns]
        if sort_columns:
            combined = combined.sort_values(sort_columns).reset_index(drop=True)
        written.extend(_write_sample_xlsx(sample_pack_dir(results_dir, sample_name), kind, combined))
    return written


def _write_sample_xlsx(dest: Path, stem: str, df: pd.DataFrame) -> list[Path]:
    """Write results/<sample>/{stem}.xlsx only (skipped if over the Excel row limit)."""
    leftover_csv = dest / f"{stem}.csv"
    if leftover_csv.is_file():
        leftover_csv.unlink()
    xlsx_path = write_xlsx(df, dest / f"{stem}.xlsx")
    if xlsx_path is None:
        return []
    return [xlsx_path]

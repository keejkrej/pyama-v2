from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from pyama import core as paths
from pyama.core.export import write_csv_and_parallel_xlsx
from pyama.core.slide import SlideMapping
from pyama.core.timeseries import parse_timeseries_path, resolve_slide_channel_from_path

SAMPLES_DIRNAME = "samples"
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
    return results_dir.resolve() / SAMPLES_DIRNAME / filesystem_safe_sample_name(sample_name)


def write_sample_traces_packs(workspace: Path, mapping: SlideMapping) -> list[Path]:
    workspace = workspace.resolve()
    timeseries_csvs = paths.discover_timeseries_csvs(paths.workspace_timeseries_dir(workspace))
    results_dir = paths.workspace_results_dir(workspace)
    frames_by_sample: dict[str, list[pd.DataFrame]] = {}
    for csv_path in timeseries_csvs:
        slide_channel = resolve_slide_channel_from_path(csv_path, mapping)
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
        output_csv = sample_pack_dir(results_dir, sample_name) / "traces.csv"
        write_csv_and_parallel_xlsx(combined, output_csv)
        written.append(output_csv)
    return written


def write_sample_table_packs(
    workspace: Path,
    mapping: SlideMapping,
    *,
    kind: str,
    combined_csv: Path,
) -> list[Path]:
    df = pd.read_csv(combined_csv)
    if "slide_channel" not in df.columns:
        raise ValueError(f"{combined_csv} is missing required column: slide_channel")
    results_dir = paths.workspace_results_dir(workspace)
    samples: dict[str, list[int]] = {}
    for slide_channel, entry in mapping.items():
        samples.setdefault(entry.sample_name, []).append(slide_channel)

    written: list[Path] = []
    for sample_name, slide_channels in samples.items():
        sample_df = df.loc[df["slide_channel"].isin(slide_channels)].copy()
        if sample_df.empty:
            continue
        output_csv = sample_pack_dir(results_dir, sample_name) / f"{kind}.csv"
        write_csv_and_parallel_xlsx(sample_df, output_csv)
        written.append(output_csv)
    return written

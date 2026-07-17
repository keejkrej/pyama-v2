from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import tifffile
from pyama.readers import open_reader

from pyama.core.bbox import (
    RoiBbox,
    discover_bbox_positions,
    parse_bbox_csv,
    validate_bboxes,
    workspace_bbox_csv_path,
    workspace_roi_pos_dir,
)

ProgressCallback = Callable[[str], None]


@dataclass(frozen=True)
class CropPositionResult:
    pos: int
    output_dir: Path
    roi_count: int


@dataclass(frozen=True)
class CropRunResult:
    written: list[CropPositionResult]
    skipped_existing: list[int]
    skipped_missing_bbox: list[int]


def _source_kind(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".nd2":
        return "nd2"
    if suffix == ".czi":
        return "czi"
    if suffix in {".tif", ".tiff"}:
        return "tif"
    raise ValueError(f"Unsupported source format for crop: {path}")


def _crop_frame(frame: np.ndarray, bbox: RoiBbox) -> np.ndarray:
    array = np.asarray(frame)
    if array.ndim != 2:
        raise ValueError(f"Expected 2D frame for crop, got shape {array.shape}")
    return array[bbox.y : bbox.y + bbox.h, bbox.x : bbox.x + bbox.w]


def _write_index(
    *,
    output_dir: Path,
    pos: int,
    source_path: Path,
    time_count: int,
    channel_count: int,
    z_count: int,
    bboxes: list[RoiBbox],
) -> None:
    index = {
        "position": pos,
        "axisOrder": "TCZYX",
        "pageOrder": ["t", "c", "z"],
        "timeCount": time_count,
        "channelCount": channel_count,
        "zCount": z_count,
        "source": {"kind": _source_kind(source_path), "path": str(source_path.resolve())},
        "rois": [
            {
                "roi": bbox.roi,
                "fileName": f"Roi{bbox.roi}.tif",
                "bbox": {"roi": bbox.roi, "x": bbox.x, "y": bbox.y, "w": bbox.w, "h": bbox.h},
                "shape": [time_count, channel_count, z_count, bbox.h, bbox.w],
            }
            for bbox in bboxes
        ],
    }
    (output_dir / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")


def crop_position(
    workspace: Path,
    source: Path,
    pos: int,
    *,
    force: bool = False,
    times: list[int] | None = None,
    channels: list[int] | None = None,
    z_slices: list[int] | None = None,
    on_progress: ProgressCallback | None = None,
) -> CropPositionResult | None:
    workspace = workspace.resolve()
    source = source.expanduser().resolve()
    bbox_path = workspace_bbox_csv_path(workspace, pos)
    if not bbox_path.is_file():
        return None

    output_dir = workspace_roi_pos_dir(workspace, pos)
    if output_dir.exists() and not force:
        return None

    bboxes = parse_bbox_csv(bbox_path)
    info, read_frame, close = open_reader(source)
    try:
        time_indices = times if times is not None else list(range(info.n_time))
        channel_indices = channels if channels is not None else list(range(info.n_chan))
        z_indices = z_slices if z_slices is not None else list(range(info.n_z))
        if not time_indices or not channel_indices or not z_indices:
            raise ValueError(f"No frames selected for crop at Pos{pos}")

        first = np.asarray(read_frame(pos, time_indices[0], channel_indices[0], z_indices[0]))
        if first.ndim != 2:
            raise ValueError(f"Expected 2D frame for Pos{pos}, got shape {first.shape}")
        height, width = int(first.shape[0]), int(first.shape[1])
        validate_bboxes(bboxes, width, height)

        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        stacks = {
            bbox.roi: np.empty(
                (len(time_indices), len(channel_indices), len(z_indices), bbox.h, bbox.w),
                dtype=first.dtype,
            )
            for bbox in bboxes
        }

        total = len(time_indices) * len(channel_indices) * len(z_indices)
        done = 0
        for t_i, time_index in enumerate(time_indices):
            for c_i, channel_index in enumerate(channel_indices):
                for z_i, z_index in enumerate(z_indices):
                    frame = np.asarray(read_frame(pos, time_index, channel_index, z_index))
                    if frame.shape != first.shape:
                        raise ValueError(
                            f"Inconsistent frame shape at Pos{pos} t={time_index} "
                            f"c={channel_index} z={z_index}: {frame.shape} vs {first.shape}"
                        )
                    for bbox in bboxes:
                        stacks[bbox.roi][t_i, c_i, z_i] = _crop_frame(frame, bbox)
                    done += 1
                    if on_progress is not None:
                        on_progress(f"Pos{pos}: cropped frame {done}/{total}")

        for bbox in bboxes:
            tifffile.imwrite(output_dir / f"Roi{bbox.roi}.tif", stacks[bbox.roi], imagej=False)

        _write_index(
            output_dir=output_dir,
            pos=pos,
            source_path=source,
            time_count=len(time_indices),
            channel_count=len(channel_indices),
            z_count=len(z_indices),
            bboxes=bboxes,
        )
    finally:
        close()

    return CropPositionResult(pos=pos, output_dir=output_dir, roi_count=len(bboxes))


def run_crop(
    *,
    workspace: Path,
    source: Path,
    positions: list[int] | None = None,
    force: bool = False,
    on_progress: ProgressCallback | None = None,
) -> CropRunResult:
    workspace = workspace.resolve()
    source = source.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Source not found: {source}")

    requested = positions if positions is not None else discover_bbox_positions(workspace)
    if not requested:
        raise ValueError(f"No bbox positions found under {workspace / 'bbox'}")

    written: list[CropPositionResult] = []
    skipped_existing: list[int] = []
    skipped_missing_bbox: list[int] = []

    for pos in requested:
        bbox_path = workspace_bbox_csv_path(workspace, pos)
        if not bbox_path.is_file():
            skipped_missing_bbox.append(pos)
            continue
        output_dir = workspace_roi_pos_dir(workspace, pos)
        if output_dir.exists() and not force:
            skipped_existing.append(pos)
            continue
        result = crop_position(
            workspace,
            source,
            pos,
            force=force,
            on_progress=on_progress,
        )
        if result is not None:
            written.append(result)

    if not written and skipped_existing and not skipped_missing_bbox:
        raise ValueError(
            "All requested ROI positions already exist. Set force=True to overwrite."
        )
    if not written and skipped_missing_bbox and not skipped_existing:
        raise ValueError(
            "No bbox CSVs found for requested positions under "
            f"{workspace / 'bbox'}: {skipped_missing_bbox}"
        )
    if not written:
        raise ValueError("No ROI positions were cropped")

    return CropRunResult(
        written=written,
        skipped_existing=skipped_existing,
        skipped_missing_bbox=skipped_missing_bbox,
    )


def format_written_crop_message(result: CropPositionResult) -> str:
    noun = "ROI" if result.roi_count == 1 else "ROIs"
    return f"Cropped {result.roi_count} {noun} for Pos{result.pos} under: {result.output_dir}"

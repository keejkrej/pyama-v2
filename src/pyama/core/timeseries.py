from __future__ import annotations

import re
from pathlib import Path

from pyama.core.slide import SlideMapping

_POS_DIR = re.compile(r"^Pos(\d+)$")
_CH_STEM = re.compile(r"^ch(\d+)$")


def parse_timeseries_path(path: Path) -> tuple[int, int]:
    """Parse ``(position, signal_channel)`` from ``timeseries/Pos{n}/ch{n}.csv``."""
    resolved = path.resolve()
    parent_match = _POS_DIR.fullmatch(resolved.parent.name)
    stem_match = _CH_STEM.fullmatch(resolved.stem)
    if parent_match is None or stem_match is None:
        raise ValueError(
            f"Cannot parse position and signal channel from timeseries path: {path}"
        )
    return int(parent_match.group(1)), int(stem_match.group(1))


def resolve_slide_channel(mapping: SlideMapping, position: int, signal_channel: int) -> int:
    matches = [
        slide_channel
        for slide_channel, entry in mapping.items()
        if position in entry.positions and entry.signal_channel == signal_channel
    ]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ValueError(
            f"No slide channel maps position {position} with signal channel {signal_channel}"
        )
    raise ValueError(
        f"Ambiguous slide channel for position {position} "
        f"signal channel {signal_channel}: {matches}"
    )


def resolve_slide_channel_from_path(csv_path: Path, mapping: SlideMapping) -> int:
    position, signal_channel = parse_timeseries_path(csv_path)
    return resolve_slide_channel(mapping, position, signal_channel)

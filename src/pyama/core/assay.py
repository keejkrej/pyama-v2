"""Write workspace ``assay.json`` in the Studio / transfection schema."""

from __future__ import annotations

import json
from pathlib import Path

from pyama.core.slide import SlideMapping, samples_to_mapping

ASSAY_FILENAME = "assay.json"


def assay_json_path(workspace: Path) -> Path:
    return workspace.resolve() / ASSAY_FILENAME


def format_inclusive_position_spec(positions: list[int]) -> str:
    """Compact inclusive ranges for Studio/transfection ``samples[].positions``."""
    if not positions:
        raise ValueError("No positions to serialize")
    ordered = sorted(set(int(position) for position in positions))
    parts: list[str] = []
    start = prev = ordered[0]
    for value in ordered[1:]:
        if value == prev + 1:
            prev = value
            continue
        parts.append(f"{start}:{prev}" if start != prev else str(start))
        start = prev = value
    parts.append(f"{start}:{prev}" if start != prev else str(start))
    return ",".join(parts)


def write_assay_json(
    workspace: Path,
    *,
    samples: list[object],
    interval_minutes: float,
    signal_channels: list[int],
    max_onset_minutes: float | None = None,
    mask_channel: int = 0,
) -> Path:
    """Rewrite ``workspace/assay.json`` from the results notebook Config.

    Always overwrites so the notebook stays the editor.
    """
    if interval_minutes <= 0:
        raise ValueError(f"INTERVAL_MINUTES must be > 0, got {interval_minutes}")
    if not signal_channels:
        raise ValueError("analysis.channels.signal requires at least one channel")
    mapping = samples_to_mapping(samples, signal_channel=int(signal_channels[0]))
    payload = {
        "type": "transfection",
        "name": workspace.resolve().name,
        "data": {"type": "nd2", "path": ""},
        "workspace": {"path": str(workspace.resolve())},
        "interval": {"value": float(interval_minutes), "unit": "minute"},
        "samples": _samples_payload(mapping),
        "analysis": {
            "channels": {
                "mask": int(mask_channel),
                "signal": [int(channel) for channel in signal_channels],
            },
        },
    }
    if max_onset_minutes is not None:
        payload["analysis"]["maxOnsetMinutes"] = float(max_onset_minutes)

    output_path = assay_json_path(workspace)
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return output_path


def _samples_payload(mapping: SlideMapping) -> list[dict[str, object]]:
    return [
        {
            "slideChannel": slide_channel,
            "name": entry.sample_name,
            "positions": format_inclusive_position_spec(entry.positions),
        }
        for slide_channel, entry in mapping.items()
    ]

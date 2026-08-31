"""Merge workspace ``assay.json`` in the Studio / transfection schema.

Both notebooks update this file. Neither clobbers the other's keys:

- ``analyze.ipynb`` writes ``type`` (new file), ``interval``, ``analysis.maxOnsetMinutes``,
  ``analysis.skipSegment`` (true; this package has no segmentation step), and
  ``analysis.channels`` (``signal`` from ``SIGNAL_CHANNEL``, ``mask`` 0).
- ``results.ipynb`` writes ``samples[]`` only. It does not invent a signal channel.
"""

from __future__ import annotations

import json
from pathlib import Path

from pyama.core.slide import SlideMapping, samples_to_mapping

ASSAY_FILENAME = "assay.json"
_ANALYZE_FIRST = "Run notebooks/analyze.ipynb first."


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


def load_assay_json(workspace: Path) -> dict[str, object]:
    path = assay_json_path(workspace)
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return raw


def merge_analyze_assay_json(
    workspace: Path,
    *,
    interval_minutes: float,
    signal_channel: int,
    max_onset_minutes: float,
    mask_channel: int = 0,
) -> Path:
    """Merge analyze-owned keys into ``workspace/assay.json``. Does not write ``samples[]``."""
    if interval_minutes <= 0:
        raise ValueError(f"INTERVAL_MINUTES must be > 0, got {interval_minutes}")
    if not isinstance(signal_channel, int) or isinstance(signal_channel, bool) or signal_channel < 0:
        raise ValueError(f"SIGNAL_CHANNEL must be a non-negative integer, got {signal_channel!r}")
    if max_onset_minutes < 0:
        raise ValueError(f"MAX_ONSET_MINUTES must be >= 0, got {max_onset_minutes}")

    path = assay_json_path(workspace)
    is_new = not path.is_file()
    payload = load_assay_json(workspace)
    if is_new:
        payload["type"] = "transfection"
        payload.setdefault("name", workspace.resolve().name)
        payload.setdefault("data", {"type": "nd2", "path": ""})
        payload.setdefault("workspace", {"path": str(workspace.resolve())})
    elif "type" not in payload:
        payload["type"] = "transfection"

    payload["interval"] = {"value": float(interval_minutes), "unit": "minute"}
    analysis = payload.get("analysis")
    if not isinstance(analysis, dict):
        analysis = {}
    analysis["maxOnsetMinutes"] = float(max_onset_minutes)
    analysis["skipSegment"] = True
    channels = analysis.get("channels")
    if not isinstance(channels, dict):
        channels = {}
    channels["mask"] = int(mask_channel)
    channels["signal"] = [int(signal_channel)]
    analysis["channels"] = channels
    payload["analysis"] = analysis
    return _dump_assay_json(workspace, payload)


def merge_results_assay_json(workspace: Path, *, samples: list[object]) -> Path:
    """Merge ``samples[]`` into ``workspace/assay.json``. Does not rewrite ``analysis.channels``."""
    payload = load_assay_json(workspace)
    mapping = samples_to_mapping(samples, signal_channel=0)
    payload["samples"] = _samples_payload(mapping)
    return _dump_assay_json(workspace, payload)


def read_assay_signal_channels(workspace: Path) -> list[int] | None:
    """Return ``analysis.channels.signal`` from assay.json, or None if that key is absent."""
    payload = load_assay_json(workspace)
    analysis = payload.get("analysis")
    if not isinstance(analysis, dict):
        return None
    channels = analysis.get("channels")
    if not isinstance(channels, dict):
        return None
    signal = channels.get("signal")
    if not isinstance(signal, list) or not signal:
        return None
    out: list[int] = []
    for item in signal:
        if not isinstance(item, int) or isinstance(item, bool) or item < 0:
            raise ValueError(
                f"analysis.channels.signal must be non-negative integers, got {item!r}"
            )
        out.append(item)
    return out


def resolve_signal_channels(workspace: Path) -> list[int]:
    """Signal for packing plots: assay.json first, else ``analysis/PosN/ch*.csv``.

    Raises if neither exists so results cannot invent ``SIGNAL_CHANNEL``.
    """
    from_json = read_assay_signal_channels(workspace)
    if from_json:
        return from_json

    from pyama.core.workspace import discover_signal_channels, workspace_analysis_dir

    try:
        discovered = discover_signal_channels(workspace_analysis_dir(workspace))
    except (ValueError, FileNotFoundError) as exc:
        raise FileNotFoundError(
            "No analysis.channels in assay.json and no analysis/Pos*/ch*.csv. "
            + _ANALYZE_FIRST
        ) from exc
    if not discovered:
        raise FileNotFoundError(
            "No analysis.channels in assay.json and no analysis/Pos*/ch*.csv. "
            + _ANALYZE_FIRST
        )
    return discovered


def _dump_assay_json(workspace: Path, payload: dict[str, object]) -> Path:
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

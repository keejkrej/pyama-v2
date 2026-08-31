import json
from pathlib import Path

import pytest

from pyama.core.assay import (
    format_inclusive_position_spec,
    load_assay_json,
    merge_analyze_assay_json,
    merge_results_assay_json,
    resolve_signal_channels,
)
from pyama.core.slide import samples_to_mapping


def test_format_inclusive_position_spec() -> None:
    assert format_inclusive_position_spec([0, 1, 2, 3]) == "0:3"
    assert format_inclusive_position_spec([5]) == "5"
    assert format_inclusive_position_spec([0, 1, 3, 4, 5]) == "0:1,3:5"


def test_merge_analyze_assay_json_creates_without_samples(tmp_path: Path) -> None:
    path = merge_analyze_assay_json(
        tmp_path,
        interval_minutes=10.0,
        signal_channel=1,
        max_onset_minutes=120.0,
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["type"] == "transfection"
    assert payload["interval"] == {"value": 10.0, "unit": "minute"}
    assert payload["analysis"]["maxOnsetMinutes"] == 120.0
    assert payload["analysis"]["channels"] == {"mask": 0, "signal": [1]}
    assert "samples" not in payload


def test_merge_results_does_not_rewrite_analysis_channels(tmp_path: Path) -> None:
    merge_analyze_assay_json(
        tmp_path,
        interval_minutes=10.0,
        signal_channel=1,
        max_onset_minutes=120.0,
    )
    samples = [
        {"name": "A", "positions": list(range(0, 40))},
        {"name": "B", "positions": [40, 41]},
    ]
    path = merge_results_assay_json(tmp_path, samples=samples)
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["analysis"]["channels"]["signal"] == [1]
    assert payload["analysis"]["maxOnsetMinutes"] == 120.0
    assert payload["interval"] == {"value": 10.0, "unit": "minute"}
    assert payload["samples"][0]["slideChannel"] == 0
    assert payload["samples"][0]["name"] == "A"
    assert payload["samples"][0]["positions"] == "0:39"
    assert payload["samples"][1]["positions"] == "40:41"
    mapping = samples_to_mapping(samples, signal_channel=1)
    assert mapping[0].positions[0] == 0
    assert mapping[0].positions[-1] == 39


def test_merge_analyze_preserves_existing_samples(tmp_path: Path) -> None:
    samples = [{"name": "kept", "positions": [0, 1]}]
    merge_results_assay_json(tmp_path, samples=samples)
    path = merge_analyze_assay_json(
        tmp_path,
        interval_minutes=5.0,
        signal_channel=2,
        max_onset_minutes=0.0,
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["samples"][0]["name"] == "kept"
    assert payload["samples"][0]["positions"] == "0:1"
    assert payload["type"] == "transfection"
    assert payload["interval"]["value"] == 5.0
    assert payload["analysis"]["channels"]["signal"] == [2]
    assert payload["analysis"]["maxOnsetMinutes"] == 0.0


def test_merge_results_alone_does_not_invent_channels(tmp_path: Path) -> None:
    path = merge_results_assay_json(
        tmp_path,
        samples=[{"name": "A", "positions": [0]}],
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["samples"][0]["name"] == "A"
    assert "analysis" not in payload
    assert "interval" not in payload


def test_resolve_signal_channels_reads_assay_json(tmp_path: Path) -> None:
    merge_analyze_assay_json(
        tmp_path,
        interval_minutes=10.0,
        signal_channel=3,
        max_onset_minutes=60.0,
    )
    assert resolve_signal_channels(tmp_path) == [3]


def test_resolve_signal_channels_falls_back_to_analysis_csv(tmp_path: Path) -> None:
    csv_path = tmp_path / "analysis" / "Pos0" / "ch2.csv"
    csv_path.parent.mkdir(parents=True)
    csv_path.write_text("roi,t,area,background,sum,corrected\n0,0,1,0,1,1\n", encoding="utf-8")
    assert resolve_signal_channels(tmp_path) == [2]
    assert "analysis" not in load_assay_json(tmp_path)


def test_resolve_signal_channels_fails_without_analyze(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="analyze.ipynb"):
        resolve_signal_channels(tmp_path)

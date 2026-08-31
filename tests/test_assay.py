import json
from pathlib import Path

from pyama.core.assay import format_inclusive_position_spec, write_assay_json
from pyama.core.slide import samples_to_mapping


def test_format_inclusive_position_spec() -> None:
    assert format_inclusive_position_spec([0, 1, 2, 3]) == "0:3"
    assert format_inclusive_position_spec([5]) == "5"
    assert format_inclusive_position_spec([0, 1, 3, 4, 5]) == "0:1,3:5"


def test_write_assay_json_overwrites_studio_schema(tmp_path: Path) -> None:
    samples = [
        {"name": "A", "positions": list(range(0, 40))},
        {"name": "B", "positions": [40, 41]},
    ]
    stale = tmp_path / "assay.json"
    stale.write_text('{"type": "old"}\n', encoding="utf-8")
    path = write_assay_json(
        tmp_path,
        samples=samples,
        interval_minutes=10.0,
        signal_channels=[1],
        max_onset_minutes=120.0,
    )
    assert path == stale
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["type"] == "transfection"
    assert payload["interval"] == {"value": 10.0, "unit": "minute"}
    assert payload["samples"][0]["slideChannel"] == 0
    assert payload["samples"][0]["name"] == "A"
    assert payload["samples"][0]["positions"] == "0:39"
    assert payload["samples"][1]["positions"] == "40:41"
    assert payload["analysis"]["channels"]["signal"] == [1]
    assert payload["analysis"]["maxOnsetMinutes"] == 120.0
    mapping = samples_to_mapping(samples, signal_channel=1)
    assert mapping[0].positions[0] == 0
    assert mapping[0].positions[-1] == 39

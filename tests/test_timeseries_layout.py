from pathlib import Path

import pandas as pd

from pyama.core import discover_timeseries_csvs, validate_slide_mapping
from pyama.services.auc import compute_auc_table
from pyama.services.timeseries import default_position_timeseries_csv_path


def test_position_timeseries_path() -> None:
    path = default_position_timeseries_csv_path(Path("/workspace"), 7, 2)
    assert path == Path("/workspace/timeseries/Pos7/ch2.csv")


def test_discovers_position_channel_tables(tmp_path: Path) -> None:
    first = tmp_path / "Pos1" / "ch0.csv"
    second = tmp_path / "Pos2" / "ch1.csv"
    for path in (second, first):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("roi,t,corrected\n0,0,1\n", encoding="utf-8")
    (tmp_path / "legacy.csv").write_text("ignored", encoding="utf-8")

    assert discover_timeseries_csvs(tmp_path) == [first, second]


def test_auc_uses_slide_channel_column(tmp_path: Path) -> None:
    csv_path = tmp_path / "Pos3" / "ch1.csv"
    csv_path.parent.mkdir(parents=True)
    pd.DataFrame(
        {
            "slide_channel": [4, 4],
            "pos": [3, 3],
            "roi": [0, 0],
            "t": [0, 1],
            "corrected": [2.0, 4.0],
        }
    ).to_csv(csv_path, index=False)

    result = compute_auc_table([csv_path], interval=2.0)
    assert result.loc[0, "slide_channel"] == 4
    assert result.loc[0, "auc"] == 6.0


def test_slide_mapping_needs_only_signal_channel() -> None:
    mapping = validate_slide_mapping(
        {0: {"positions": [0, 1], "signal_channel": 2, "sample_name": "sample"}}
    )
    assert mapping[0].signal_channel == 2

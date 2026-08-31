from pathlib import Path

import pandas as pd
import pytest

from pyama.core import discover_timeseries_csvs, resolve_slide_channel, validate_slide_mapping
from pyama.core.roi import read_position_index
from pyama.services.auc import compute_auc_table
from pyama.services import timeseries as timeseries_service
from pyama.services.timeseries import (
    default_position_timeseries_csv_path,
    run_slide_timeseries,
)


def test_position_timeseries_path() -> None:
    path = default_position_timeseries_csv_path(Path("/workspace"), 7, 2)
    assert path == Path("/workspace/analysis/Pos7/ch2.csv")


def test_group_panels_by_slide_channel_aggregates_positions(tmp_path: Path) -> None:
    from pyama.services.plot_timeseries import group_panels_by_slide_channel

    mapping = validate_slide_mapping(
        {
            0: {"positions": [0, 1], "signal_channel": 1, "sample_name": "A"},
            1: {"positions": [2], "signal_channel": 1, "sample_name": "B"},
        }
    )
    panels: list[tuple[Path, pd.DataFrame]] = []
    for pos in (0, 1, 2):
        csv_path = tmp_path / f"Pos{pos}" / "ch1.csv"
        csv_path.parent.mkdir(parents=True)
        df = pd.DataFrame({"roi": [0], "t": [0], "corrected": [1.0]})
        panels.append((csv_path, df))

    sample_panels = group_panels_by_slide_channel(panels, mapping)
    assert [slide_channel for slide_channel, _frames in sample_panels] == [0, 1]
    assert [len(frames) for _slide_channel, frames in sample_panels] == [2, 1]
    assert "pos" in sample_panels[0][1][0][1].columns


def test_writes_csv_as_each_position_finishes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    order: list[tuple[str, int]] = []
    monkeypatch.setattr(timeseries_service.os, "cpu_count", lambda: 1)

    def fake_run_position_metrics(
        workspace: Path,
        *,
        signal_channel: int,
        resolved_pos: int,
    ) -> tuple[int, int, pd.DataFrame]:
        order.append(("compute", resolved_pos))
        df = pd.DataFrame(
            {
                "roi": [0],
                "t": [0],
                "area": [1],
                "background": [0.0],
                "sum": [1.0],
                "corrected": [1.0],
            }
        )
        return (signal_channel, resolved_pos, df)

    monkeypatch.setattr(
        "pyama.services.timeseries._run_position_metrics",
        fake_run_position_metrics,
    )

    def on_csv_written(position: int, path: Path, rows: int) -> None:
        order.append(("write", position))
        assert path.is_file()
        assert rows == 1
        assert path.suffix == ".csv"
        assert not path.with_suffix(".xlsx").exists()

    for pos in (0, 1):
        (tmp_path / "roi" / f"Pos{pos}").mkdir(parents=True)
    result = run_slide_timeseries(
        tmp_path,
        signal_channel=1,
        on_csv_written=on_csv_written,
    )

    assert order == [
        ("compute", 0),
        ("write", 0),
        ("compute", 1),
        ("write", 1),
    ]
    assert [position for position, _path, _rows in result.written_outputs] == [0, 1]


def test_discovers_position_channel_tables(tmp_path: Path) -> None:
    first = tmp_path / "Pos1" / "ch0.csv"
    second = tmp_path / "Pos2" / "ch1.csv"
    for path in (second, first):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("roi,t,corrected\n0,0,1\n", encoding="utf-8")
    (tmp_path / "legacy.csv").write_text("ignored", encoding="utf-8")

    assert discover_timeseries_csvs(tmp_path) == [first, second]


def test_auc_table_is_position_rows_without_slide_channel(tmp_path: Path) -> None:
    csv_path = tmp_path / "Pos3" / "ch1.csv"
    csv_path.parent.mkdir(parents=True)
    pd.DataFrame(
        {
            "roi": [0, 0],
            "t": [0, 1],
            "area": [1, 1],
            "background": [0.0, 0.0],
            "sum": [2.0, 4.0],
            "corrected": [2.0, 4.0],
        }
    ).to_csv(csv_path, index=False)

    result = compute_auc_table([csv_path], interval=2.0)
    assert result.loc[0, "pos"] == 3
    assert result.loc[0, "auc"] == 6.0
    assert "slide_channel" not in result.columns


def test_slide_mapping_needs_only_signal_channel() -> None:
    mapping = validate_slide_mapping(
        {0: {"positions": [0, 1], "signal_channel": 2, "sample_name": "sample"}}
    )
    assert mapping[0].signal_channel == 2


def test_resolve_slide_channel_unique_match() -> None:
    mapping = validate_slide_mapping(
        {
            0: {"positions": [1, 2], "signal_channel": 0, "sample_name": "a"},
            1: {"positions": [3], "signal_channel": 1, "sample_name": "b"},
        }
    )
    assert resolve_slide_channel(mapping, position=2, signal_channel=0) == 0
    assert resolve_slide_channel(mapping, position=3, signal_channel=1) == 1


def test_resolve_slide_channel_ambiguous() -> None:
    mapping = validate_slide_mapping(
        {
            0: {"positions": [1], "signal_channel": 0, "sample_name": "a"},
            1: {"positions": [1], "signal_channel": 0, "sample_name": "b"},
        }
    )
    with pytest.raises(ValueError, match="Ambiguous"):
        resolve_slide_channel(mapping, position=1, signal_channel=0)


def _write_index(path: Path, *, time_count: int, time_indices: list[int] | None) -> None:
    payload = {
        "position": 0,
        "axisOrder": "TCZYX",
        "timeCount": time_count,
        "channelCount": 1,
        "zCount": 1,
        "rois": [
            {
                "roi": 0,
                "fileName": "roi0.tif",
                "bbox": {"roi": 0, "x": 0, "y": 0, "w": 2, "h": 2},
            }
        ],
    }
    if time_indices is not None:
        payload["timeIndices"] = time_indices
    path.write_text(__import__("json").dumps(payload), encoding="utf-8")


def test_time_indices_default_dense(tmp_path: Path) -> None:
    pos_dir = tmp_path / "Pos0"
    pos_dir.mkdir()
    _write_index(pos_dir / "index.json", time_count=4, time_indices=None)
    index = read_position_index(pos_dir)
    assert index.time_indices == (0, 1, 2, 3)


def test_time_indices_downsampled(tmp_path: Path) -> None:
    pos_dir = tmp_path / "Pos0"
    pos_dir.mkdir()
    _write_index(pos_dir / "index.json", time_count=4, time_indices=[0, 6, 12, 18])
    index = read_position_index(pos_dir)
    assert index.time_indices == (0, 6, 12, 18)


def test_time_indices_length_mismatch(tmp_path: Path) -> None:
    pos_dir = tmp_path / "Pos0"
    pos_dir.mkdir()
    _write_index(pos_dir / "index.json", time_count=3, time_indices=[0, 6])
    with pytest.raises(ValueError, match="timeIndices length"):
        read_position_index(pos_dir)

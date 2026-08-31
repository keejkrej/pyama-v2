from pathlib import Path

import pandas as pd
import pytest

from pyama.core.slide import samples_to_mapping
from pyama.services import plot_auc


def _write_auc_pos(workspace: Path, position: int, auc: float) -> None:
    pos_dir = workspace / "analysis" / f"Pos{position}"
    pos_dir.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(
        {
            "roi": [0, 0],
            "t": [0, 1],
            "area": [1, 1],
            "background": [0.0, 0.0],
            "sum": [2.0, 4.0],
            "corrected": [2.0, 4.0],
        }
    ).to_csv(pos_dir / "ch1.csv", index=False)
    pd.DataFrame({"pos": [position], "roi": [0], "auc": [auc]}).to_csv(pos_dir / "auc.csv", index=False)


def test_run_plot_auc_writes_root_boxplots_not_per_sample(tmp_path: Path) -> None:
    _write_auc_pos(tmp_path, 0, 6.0)
    _write_auc_pos(tmp_path, 1, 8.0)
    mapping = samples_to_mapping(
        [
            {"name": "A", "positions": [0]},
            {"name": "B", "positions": [1]},
        ],
        signal_channel=1,
    )
    written = plot_auc.run_plot_auc(
        workspace=tmp_path,
        mapping=mapping,
        slide_channel_names={0: "A", 1: "B"},
    )
    names = {path.name for path in written}
    assert "auc.png" in names
    assert "auc_log.png" not in names
    assert "auc.xlsx" in names
    results = tmp_path / "results"
    assert (results / "auc.png").is_file()
    assert not (results / "auc_log.png").exists()
    assert (results / "A" / "auc.xlsx").is_file()
    assert not (results / "A" / "auc.csv").exists()
    assert not (results / "A" / "auc.png").exists()
    assert not (results / "A" / "auc_log.png").exists()
    assert not (results / "auc.csv").exists()


def test_run_plot_auc_root_boxplot_places_samples_on_x(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    kept: list[object] = []
    monkeypatch.setattr(plot_auc.plt, "close", lambda fig=None: kept.append(fig))
    _write_auc_pos(tmp_path, 0, 6.0)
    _write_auc_pos(tmp_path, 1, 8.0)
    mapping = samples_to_mapping(
        [
            {"name": "A", "positions": [0]},
            {"name": "B", "positions": [1]},
        ],
        signal_channel=1,
    )
    plot_auc.run_plot_auc(
        workspace=tmp_path,
        mapping=mapping,
        slide_channel_names={0: "A", 1: "B"},
    )
    fig = kept[0]
    labels = [tick.get_text() for tick in fig.axes[0].get_xticklabels()]
    assert any("A" in label for label in labels)
    assert any("B" in label for label in labels)
    assert fig.axes[0].get_xlabel() == "condition"

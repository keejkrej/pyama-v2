from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from pyama.core.slide import samples_to_mapping
from pyama.services import plot_fit
from pyama.services.sample_packs import filesystem_safe_sample_name


def test_pearson_annotation_omits_r_when_undefined() -> None:
    assert plot_fit.pearson_annotation(0.5, 12) == "r = 0.50\nn = 12"
    assert plot_fit.pearson_annotation(None, 1) == "n = 1"
    assert plot_fit.pearson_r(np.array([1.0]), np.array([2.0])) is None


def test_write_expression_rate_vs_onset_scatter_is_single_panel_per_sample(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    kept: list[object] = []
    monkeypatch.setattr(plot_fit.plt, "close", lambda fig=None: kept.append(fig))
    df = pd.DataFrame(
        {
            "success": [True, False, True],
            "translation_onset": [10.0, 99.0, 20.0],
            "expression_rate": [1.0, 99.0, 2.0],
        }
    )
    output_plot = tmp_path / "A" / "expression_rate_vs_onset.png"
    plot_fit.write_expression_rate_vs_onset_scatter(
        df,
        output_plot=output_plot,
        sample_label="A",
    )
    assert output_plot.is_file()
    fig = kept[0]
    assert len(fig.axes) == 1
    ax = fig.axes[0]
    assert ax.get_title() == "A"
    assert ax.get_legend() is None
    assert ax.get_xlabel() == "translation onset"
    assert ax.get_ylabel() == "expression rate"
    assert len(ax.collections) == 1
    texts = "\n".join(text.get_text() for text in ax.texts)
    assert "r =" in texts
    assert "n =" in texts


def _write_analysis_pos(workspace: Path, position: int, *, onset: float, rate: float) -> None:
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
    pd.DataFrame({"pos": [position], "roi": [0], "auc": [6.0]}).to_csv(pos_dir / "auc.csv", index=False)
    pd.DataFrame(
        {
            "pos": [position],
            "roi": [0],
            "success": ["true"],
            "intensity_offset": [0.0],
            "protein_decay_rate": [0.1],
            "protein_lifetime": [10.0],
            "mrna_decay_rate": [0.2],
            "mrna_lifetime": [5.0],
            "translation_onset": [onset],
            "expression_amplitude": [10.0],
            "expression_rate": [rate],
        }
    ).to_csv(pos_dir / "fit.csv", index=False)


def test_run_plot_fit_writes_per_sample_scatter_and_root_boxplots(tmp_path: Path) -> None:
    _write_analysis_pos(tmp_path, 0, onset=10.0, rate=1.0)
    _write_analysis_pos(tmp_path, 1, onset=20.0, rate=2.0)
    mapping = samples_to_mapping(
        [
            {"name": "A", "positions": [0]},
            {"name": "B", "positions": [1]},
        ],
        signal_channel=1,
    )
    written = plot_fit.run_plot_fit(
        workspace=tmp_path,
        interval=10.0,
        mapping=mapping,
        slide_channel_names={0: "A", 1: "B"},
    )
    names = {path.name for path in written}
    assert "expression_rate_vs_onset.png" in names
    assert "traces_fit.png" in names
    assert "traces_fit_shared_y.png" in names
    results = tmp_path / "results"
    sample_a = results / "A"
    sample_b = results / "B"
    for name in (
        "auc.png",
        "expression_rate.png",
        "expression_rate_log.png",
        "onset_time.png",
        "baseline_intensity.png",
        "protein_lifetime.png",
        "mrna_lifetime.png",
        "area_summary.png",
    ):
        assert not (sample_a / name).exists(), name
    assert not (results / "expression_rate_vs_onset.png").exists()
    assert (sample_a / "expression_rate_vs_onset.png").is_file()
    assert (sample_b / "expression_rate_vs_onset.png").is_file()
    assert (sample_a / "traces_fit.png").is_file()
    assert (sample_a / "traces_fit_shared_y.png").is_file()
    assert (sample_a / "fit.xlsx").is_file()
    assert not (sample_a / "fit.csv").exists()
    assert not (results / "traces_fit_shared_y.png").exists()
    assert not (results / "fit.csv").exists()
    for name in (
        "baseline_intensity.png",
        "protein_lifetime.png",
        "mrna_lifetime.png",
        "onset_time.png",
        "expression_rate.png",
    ):
        assert (results / name).is_file(), name
    assert not (results / "expression_rate_log.png").exists()
    assert not (results / "auc_log.png").exists()
    assert filesystem_safe_sample_name("A") == "A"

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from pyama.core.slide import validate_slide_mapping
from pyama.services import plot_fit


def test_pearson_annotation_omits_r_when_undefined() -> None:
    assert plot_fit.pearson_annotation(0.5, 12) == "r = 0.50\nn = 12"
    assert plot_fit.pearson_annotation(None, 1) == "n = 1"
    assert plot_fit.pearson_r(np.array([1.0]), np.array([2.0])) is None


def test_write_expression_rate_vs_onset_scatter_uses_successful_finite_rows(tmp_path: Path) -> None:
    df = pd.DataFrame(
        {
            "slide_channel": [0, 0, 1, 1],
            "success": [True, False, True, True],
            "translation_onset": [10.0, 99.0, 20.0, np.inf],
            "expression_rate": [1.0, 99.0, 2.0, 3.0],
        }
    )
    output_plot = tmp_path / "expression_rate_vs_onset.png"
    plot_fit.write_expression_rate_vs_onset_scatter(
        df,
        output_plot=output_plot,
        slide_channel_names={0: "A", 1: "B"},
    )
    assert output_plot.is_file()
    assert output_plot.stat().st_size > 0


def test_expression_rate_vs_onset_is_per_sample_subplots_not_overlay(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    kept: list[object] = []
    monkeypatch.setattr(plot_fit.plt, "close", lambda fig=None: kept.append(fig))
    mapping = validate_slide_mapping(
        {
            0: {"positions": [0], "signal_channel": 1, "sample_name": "A"},
            1: {"positions": [1], "signal_channel": 1, "sample_name": "B"},
        }
    )
    df = pd.DataFrame(
        {
            "slide_channel": [0, 0, 1, 1],
            "success": [True, True, True, True],
            "translation_onset": [10.0, 12.0, 20.0, 22.0],
            "expression_rate": [1.0, 2.0, 3.0, 4.0],
        }
    )
    plot_fit.write_expression_rate_vs_onset_scatter(
        df,
        output_plot=tmp_path / "expression_rate_vs_onset.png",
        slide_channel_names={0: "A", 1: "B"},
        columns=3,
        mapping=mapping,
    )
    fig = kept[0]
    scatter_axes = [ax for ax in fig.axes if ax.collections]
    assert len(scatter_axes) == 2
    assert {ax.get_title() for ax in scatter_axes} == {"A", "B"}
    for ax in scatter_axes:
        assert ax.get_legend() is None
        _handles, labels = ax.get_legend_handles_labels()
        assert labels == []
        assert ax.get_xlabel() == "translation onset"
        assert ax.get_ylabel() == "expression rate"
        assert len(ax.collections) == 1


def test_run_plot_fit_writes_expression_rate_vs_onset(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(plot_fit, "infer_timeseries_csvs", lambda _path: [])
    monkeypatch.setattr(plot_fit, "write_fitted_trace_grid", lambda *_args, **_kwargs: None)

    fit_csv = tmp_path / "results" / "fit.csv"
    fit_csv.parent.mkdir()
    pd.DataFrame(
        {
            "slide_channel": [0, 1],
            "pos": [0, 1],
            "roi": [0, 0],
            "success": [True, True],
            "intensity_offset": [0.0, 0.0],
            "protein_decay_rate": [0.1, 0.1],
            "mrna_decay_rate": [0.2, 0.2],
            "translation_onset": [10.0, 20.0],
            "expression_amplitude": [10.0, 20.0],
        }
    ).to_csv(fit_csv, index=False)

    mapping = validate_slide_mapping(
        {
            0: {"positions": [0], "signal_channel": 1, "sample_name": "A"},
            1: {"positions": [1], "signal_channel": 1, "sample_name": "B"},
        }
    )
    written = plot_fit.run_plot_fit(
        fit_csv,
        slide_channel_names={0: "A", 1: "B"},
        interval=10.0,
        mapping=mapping,
    )
    names = [path.name for path in written]
    assert "expression_rate.png" in names
    scatter = next(path for path in written if path.name == "expression_rate_vs_onset.png")
    assert scatter.parent == fit_csv.parent
    assert scatter.is_file()

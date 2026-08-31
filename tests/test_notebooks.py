from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def test_analyze_notebook_is_sample_agnostic() -> None:
    text = (REPO / "notebooks" / "analyze.ipynb").read_text(encoding="utf-8")
    assert "SLIDE_MAPPING" not in text
    assert "sample_name" not in text
    assert "plot_timeseries" not in text
    assert "plot_auc" not in text
    assert "plot_fit" not in text
    assert "SIGNAL_CHANNEL" in text
    assert "MAX_ONSET_MINUTES" in text
    assert "merge_analyze_assay_json" in text
    assert "merge_results_assay_json" not in text
    assert "SAMPLES" not in text
    assert "MASK_CHANNEL" not in text


def test_results_notebook_owns_samples_and_plots() -> None:
    text = (REPO / "notebooks" / "results.ipynb").read_text(encoding="utf-8")
    assert "SAMPLES" in text
    assert "merge_results_assay_json" in text
    assert "resolve_signal_channels" in text
    assert "plot_timeseries" in text
    assert "plot_auc" in text
    assert "plot_fit" in text
    assert "MAX_ONSET_MINUTES" not in text
    assert "SIGNAL_CHANNEL" not in text
    assert "MASK_CHANNEL" not in text
    assert "merge_analyze_assay_json" not in text
    assert "write_assay_json" not in text

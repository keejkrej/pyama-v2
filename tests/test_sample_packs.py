from pathlib import Path

import pandas as pd

from pyama.core.slide import validate_slide_mapping
from pyama.services.sample_packs import (
    filesystem_safe_sample_name,
    write_sample_table_packs,
    write_sample_traces_packs,
)


def test_sample_packs_write_three_stems_under_results_samples(tmp_path: Path) -> None:
    mapping = validate_slide_mapping(
        {0: {"positions": [0], "signal_channel": 1, "sample_name": "HeLa/wt"}}
    )
    pos_dir = tmp_path / "timeseries" / "Pos0"
    pos_dir.mkdir(parents=True)
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

    results_dir = tmp_path / "results"
    results_dir.mkdir()
    pd.DataFrame(
        {"slide_channel": [0], "pos": [0], "roi": [0], "auc": [6.0]}
    ).to_csv(results_dir / "auc.csv", index=False)
    pd.DataFrame(
        {
            "slide_channel": [0],
            "pos": [0],
            "roi": [0],
            "translation_onset": [10.0],
            "expression_rate": [1.0],
            "success": ["true"],
        }
    ).to_csv(results_dir / "fit.csv", index=False)

    write_sample_traces_packs(tmp_path, mapping)
    write_sample_table_packs(
        tmp_path, mapping, kind="auc", combined_csv=results_dir / "auc.csv"
    )
    write_sample_table_packs(
        tmp_path, mapping, kind="fit", combined_csv=results_dir / "fit.csv"
    )

    sample_dir = results_dir / "samples" / filesystem_safe_sample_name("HeLa/wt")
    for stem in ("traces", "auc", "fit"):
        csv_path = sample_dir / f"{stem}.csv"
        xlsx_path = sample_dir / f"{stem}.xlsx"
        assert csv_path.is_file(), csv_path
        assert xlsx_path.is_file(), xlsx_path

    traces = pd.read_csv(sample_dir / "traces.csv")
    assert list(traces.columns) == [
        "slide_channel",
        "sample",
        "pos",
        "roi",
        "t",
        "area",
        "background",
        "sum",
        "corrected",
    ]
    assert traces.loc[0, "sample"] == "HeLa/wt"
    assert (results_dir / "auc.csv").is_file()
    assert (results_dir / "fit.csv").is_file()

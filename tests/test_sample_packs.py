from pathlib import Path

import pandas as pd

from pyama.core.slide import samples_to_mapping
from pyama.services.sample_packs import (
    filesystem_safe_sample_name,
    write_sample_table_xlsx,
    write_sample_traces_xlsx,
)


def test_sample_packs_write_xlsx_only_under_results_sample(tmp_path: Path) -> None:
    mapping = samples_to_mapping(
        [{"name": "HeLa/wt", "positions": [0]}],
        signal_channel=1,
    )
    pos_dir = tmp_path / "analysis" / "Pos0"
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
    pd.DataFrame({"pos": [0], "roi": [0], "auc": [6.0]}).to_csv(pos_dir / "auc.csv", index=False)
    pd.DataFrame(
        {
            "pos": [0],
            "roi": [0],
            "translation_onset": [10.0],
            "expression_rate": [1.0],
            "success": ["true"],
        }
    ).to_csv(pos_dir / "fit.csv", index=False)

    sample_dir = tmp_path / "results" / filesystem_safe_sample_name("HeLa/wt")
    sample_dir.mkdir(parents=True)
    (sample_dir / "traces.csv").write_text("stale\n", encoding="utf-8")

    write_sample_traces_xlsx(tmp_path, mapping)
    write_sample_table_xlsx(
        tmp_path,
        mapping,
        kind="auc",
        df=pd.read_csv(pos_dir / "auc.csv"),
    )
    write_sample_table_xlsx(
        tmp_path,
        mapping,
        kind="fit",
        df=pd.read_csv(pos_dir / "fit.csv"),
    )

    for stem in ("traces", "auc", "fit"):
        assert (sample_dir / f"{stem}.xlsx").is_file(), stem
        assert not (sample_dir / f"{stem}.csv").exists(), stem

    traces = pd.read_excel(sample_dir / "traces.xlsx")
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
    assert not (tmp_path / "results" / "auc.csv").exists()
    assert not (tmp_path / "results" / "fit.csv").exists()
    assert not (tmp_path / "timeseries").exists()

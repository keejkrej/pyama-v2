from pathlib import Path

import pandas as pd

from pyama.core.slide import samples_to_mapping
from pyama.services import plot_timeseries


def test_run_plot_timeseries_writes_per_sample_png_and_xlsx(tmp_path: Path) -> None:
    for position in (0, 1):
        pos_dir = tmp_path / "analysis" / f"Pos{position}"
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

    mapping = samples_to_mapping(
        [
            {"name": "A", "positions": [0]},
            {"name": "B", "positions": [1]},
        ],
        signal_channel=1,
    )
    written = plot_timeseries.run_plot_timeseries(
        workspace=tmp_path,
        interval=10.0,
        mapping=mapping,
        slide_channel_names={0: "A", 1: "B"},
    )
    names = {path.name for path in written}
    assert "traces.png" in names
    assert "traces_summary.png" in names
    assert "area.png" in names
    assert "traces.xlsx" in names
    assert not (tmp_path / "results" / "traces.png").exists()
    assert not (tmp_path / "results" / "A" / "traces.csv").exists()
    assert (tmp_path / "results" / "A" / "traces.xlsx").is_file()
    assert (tmp_path / "results" / "A" / "traces.png").is_file()
    assert (tmp_path / "results" / "B" / "traces_summary.png").is_file()

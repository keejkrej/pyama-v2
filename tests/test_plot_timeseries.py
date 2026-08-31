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
    assert "traces_shared_y.png" in names
    assert "traces_summary.png" in names
    assert "traces_summary_shared_y.png" in names
    assert "area.png" in names
    assert "area_shared_y.png" in names
    assert "traces.xlsx" in names
    assert "traces.csv" not in names
    assert "area_summary.png" not in names
    assert not (tmp_path / "results" / "traces.png").exists()
    assert not (tmp_path / "results" / "traces_shared_y.png").exists()
    assert not (tmp_path / "results" / "A" / "traces.csv").exists()
    assert not (tmp_path / "results" / "A" / "area_summary.png").exists()
    assert (tmp_path / "results" / "A" / "traces.xlsx").is_file()
    assert (tmp_path / "results" / "A" / "traces.png").is_file()
    assert (tmp_path / "results" / "A" / "traces_shared_y.png").is_file()
    assert (tmp_path / "results" / "B" / "traces_summary.png").is_file()
    assert (tmp_path / "results" / "B" / "traces_summary_shared_y.png").is_file()
    assert (tmp_path / "results" / "B" / "area.png").is_file()
    assert (tmp_path / "results" / "B" / "area_shared_y.png").is_file()


def test_shared_y_companions_share_ylim_across_samples_and_are_single_panel(
    tmp_path: Path, monkeypatch
) -> None:
    ylims: dict[str, list[tuple[float, float]]] = {}
    axes_counts: dict[str, list[int]] = {}
    original_save = plot_timeseries._save_figure

    def capture(fig, output_plot):
        name = output_plot.name
        ylims.setdefault(name, []).append(tuple(fig.axes[0].get_ylim()))
        axes_counts.setdefault(name, []).append(len(fig.axes))
        return original_save(fig, output_plot)

    monkeypatch.setattr(plot_timeseries, "_save_figure", capture)

    for position, corrected in ((0, [2.0, 4.0]), (1, [200.0, 400.0])):
        pos_dir = tmp_path / "analysis" / f"Pos{position}"
        pos_dir.mkdir(parents=True)
        pd.DataFrame(
            {
                "roi": [0, 0],
                "t": [0, 1],
                "area": [1.0, 2.0] if position == 0 else [10.0, 20.0],
                "background": [0.0, 0.0],
                "sum": corrected,
                "corrected": corrected,
            }
        ).to_csv(pos_dir / "ch1.csv", index=False)

    mapping = samples_to_mapping(
        [
            {"name": "A", "positions": [0]},
            {"name": "B", "positions": [1]},
        ],
        signal_channel=1,
    )
    plot_timeseries.run_plot_timeseries(
        workspace=tmp_path,
        interval=10.0,
        mapping=mapping,
        slide_channel_names={0: "A", 1: "B"},
    )
    for name in ("traces_shared_y.png", "traces_summary_shared_y.png", "area_shared_y.png"):
        assert len(ylims[name]) == 2
        assert ylims[name][0] == ylims[name][1]
        assert axes_counts[name] == [1, 1]
    assert ylims["traces.png"][0] != ylims["traces.png"][1]

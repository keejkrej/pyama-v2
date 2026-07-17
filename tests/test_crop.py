from __future__ import annotations

from pathlib import Path

import numpy as np

from pyama.core.bbox import RoiBbox
from pyama.core.roi import read_position_index, read_roi_stack
from pyama.readers.base import ImageInfo
from pyama.services import crop


def test_crop_position_worker_count_caps_at_positions_and_env(monkeypatch) -> None:
    monkeypatch.delenv("PYAMA_CROP_MAX_WORKERS", raising=False)
    monkeypatch.setattr(crop.os, "cpu_count", lambda: 8)
    assert crop.crop_position_worker_count(3) == 3
    assert crop.crop_position_worker_count(20) == 8

    monkeypatch.setenv("PYAMA_CROP_MAX_WORKERS", "2")
    assert crop.crop_position_worker_count(20) == 2


def test_frame_major_crop_reads_each_plane_once(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    source = tmp_path / "source.nd2"
    source.write_bytes(b"placeholder")
    (workspace / "bbox").mkdir(parents=True)
    (workspace / "bbox" / "Pos0.csv").write_text(
        "roi,x,y,w,h\n0,0,0,2,2\n1,2,0,2,2\n",
        encoding="utf-8",
    )

    reads: list[tuple[int, int, int, int]] = []

    def read_frame(p: int, t: int, c: int, z: int) -> np.ndarray:
        reads.append((p, t, c, z))
        # Distinct pixels so crops are identifiable: value = 1000*t + 100*c + 10*z + x
        yy, xx = np.mgrid[0:4, 0:4]
        return (1000 * t + 100 * c + 10 * z + xx).astype(np.uint16)

    info = ImageInfo(n_pos=1, n_time=2, n_chan=2, n_z=1)
    result = crop._crop_position_with_reader(
        workspace=workspace,
        source=source,
        pos=0,
        bboxes=[
            RoiBbox(roi=0, x=0, y=0, w=2, h=2),
            RoiBbox(roi=1, x=2, y=0, w=2, h=2),
        ],
        info=info,
        read_frame=read_frame,
        force=False,
        times=None,
        channels=None,
        z_slices=None,
        on_progress=None,
    )

    assert result.roi_count == 2
    # validate + 2*2*1 streamed frames, with first plane reused => 1 + 3 unique? 
    # First plane is read once for validate, then reused in stream (not counted twice in reads
    # for the first plane during stream). Stream still calls read_frame_or_first which returns
    # cached first for (0,0,0,0) and read_frame for the other 3 planes.
    assert reads[0] == (0, 0, 0, 0)
    assert set(reads[1:]) == {(0, 0, 1, 0), (0, 1, 0, 0), (0, 1, 1, 0)}
    assert len(reads) == 4  # one validate + three remaining planes

    index = read_position_index(result.output_dir)
    assert index.time_count == 2
    assert index.channel_count == 2
    assert index.z_count == 1

    stack0 = read_roi_stack(result.output_dir / "Roi0.tif", (2, 2, 1, 2, 2))
    stack1 = read_roi_stack(result.output_dir / "Roi1.tif", (2, 2, 1, 2, 2))
    # t=1,c=0,z=0 plane: value base 1000, roi0 x=0..1, roi1 x=2..3
    assert stack0[1, 0, 0, 0, 0] == 1000
    assert stack1[1, 0, 0, 0, 0] == 1002

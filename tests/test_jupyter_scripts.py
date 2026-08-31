from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "scripts"


def _read(name: str) -> str:
    return (SCRIPTS / name).read_text(encoding="utf-8")


def test_old_launcher_names_are_gone() -> None:
    for name in (
        "notebook.sh",
        "notebook.ps1",
        "jupyter.sh",
        "jupyter.ps1",
        "jupyterhub.sh",
        "jupyterhub.ps1",
    ):
        assert not (SCRIPTS / name).exists(), name


def test_jupyter_hub_registers_lisca_kernel_and_does_not_start_server() -> None:
    text = _read("jupyter-hub.sh")
    assert "python -m ipykernel install" in text
    assert "--name lisca" in text
    assert '--display-name "Lisca"' in text
    assert "jupyter notebook" not in text
    assert "jupyterhub-singleuser" not in text
    assert "jupyter lab" not in text


def test_jupyter_hub_ps1_registers_lisca_kernel_and_does_not_start_server() -> None:
    text = _read("jupyter-hub.ps1")
    assert "ipykernel install" in text
    assert "--name lisca" in text
    assert '--display-name "Lisca"' in text
    assert "jupyter notebook" not in text
    assert "jupyterhub-singleuser" not in text


def test_jupyter_notebook_starts_local_server() -> None:
    text = _read("jupyter-notebook.sh")
    assert "jupyter notebook" in text
    assert "ipykernel install" not in text


def test_readme_points_at_dashed_script_names() -> None:
    readme = (REPO / "README.md").read_text(encoding="utf-8")
    assert "bash scripts/jupyter-notebook.sh" in readme
    assert "bash scripts/jupyter-hub.sh" in readme
    assert "scripts/notebook.sh" not in readme
    assert "jupyterhub.sh" not in readme
    assert "scripts/jupyter.sh" not in readme

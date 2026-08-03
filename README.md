# Pyama

Desktop app and Python analysis package for microscopy ROI workflows.

- `apps/pyama`: Tauri desktop app (`src/` frontend, `src-tauri/` Rust backend)
- `src/pyama`: Python package for ROI crop, slide mapping, segmentation, timeseries, AUC, and fitting (driven from `notebooks/crop.ipynb` and `notebooks/analyze.ipynb`)

Tooling is **Vite+** (`vp` / `vite-plus`).

## Tasks

- `vp install`: install JS dependencies
- `vp run -F pyama dev` / `bun run dev:pyama`: start the desktop app (`tauri dev`)
- `vp run -F pyama build` / `bun run build:pyama`: build the desktop frontend
- `vp test` / `bun run test`: run app tests
- `vp run -r typecheck` / `bun run check`: typecheck JS packages and `cargo check --workspace`
- `vp run -F pyama check:tauri`: `cargo check` for the Tauri crate

## Desktop app

The UI talks to the Rust host via **Tauri IPC** (`invoke`). Use `bun run dev:pyama` for local development.

## Python analysis

Experiment configuration lives in Jupyter notebooks. Typical handoff from **LiSCA Aligner** (light align → `bbox/` only, no long crop jobs in the webapp):

1. **Crop** (`notebooks/crop.ipynb`): ND2/CZI + `bbox/` → `roi/` — **this package is the Python crop goal source**
2. **Analyze** (`notebooks/analyze.ipynb`): `segment` → `timeseries` → … — or use sibling `lisca-transfection-assay` for transfection analysis CLI

Nontechnical path while Studio is still in dev: Aligner → these notebooks. Power users/agents often crop here (or `lisca-crop`) then run `transfection` analysis separately.

### Install

- macOS / Linux: `bash scripts/install.sh`
- Windows: `.\scripts\install.ps1`

```bash
uv sync --extra notebook
```

### Run notebooks

- macOS / Linux: `bash scripts/notebook.sh`
- Windows: `.\scripts\notebook.ps1`

Opens Jupyter on the `notebooks/` folder (`crop.ipynb`, `analyze.ipynb`).

# Pyama

Desktop app and Python analysis package for microscopy ROI workflows.

- `apps/pyama`: Tauri desktop app (`src/` frontend, `src-tauri/` Rust backend)
- `src/pyama`: Python package for notebook-driven ROI crop, timeseries, AUC, and fitting

Tooling is **Vite+** (`vp` / `vite-plus`).

## Tasks

- `vp install`: install JS dependencies
- `vp run -F pyama dev` / `pnpm dev:pyama`: start the desktop app (`tauri dev`)
- `vp run -F pyama build` / `pnpm build:pyama`: build the desktop frontend
- `vp test` / `pnpm test`: run app tests
- `vp run -r typecheck` / `pnpm check`: typecheck JS packages and `cargo check --workspace`
- `vp run -F pyama check:tauri`: `cargo check` for the Tauri crate

## Desktop app

The UI talks to the Rust host via **Tauri IPC** (`invoke`). Use `pnpm dev:pyama` for local development. The app aligns the Grid and exports BBox CSVs; ROI cropping is intentionally done in `notebooks/crop.ipynb`.

## Python analysis

Experiment configuration lives in Jupyter notebooks. Typical handoff from **LiSCA Aligner** (light align → `bbox/` only, no long crop jobs in the webapp):

1. **Crop** (`notebooks/crop.ipynb`): ND2/CZI + `bbox/` → `roi/` — **this package is the Python crop goal source**
2. **Analyze** (`notebooks/analyze.ipynb`): Config cell sets `WORKSPACE`, `INTERVAL_MINUTES`, and `SLIDE_MAPPING` — no `assay.json`. Unsegmented `timeseries` → plots → AUC → fit. Tables: `timeseries/Pos{n}/ch{n}.csv` (columns: `roi`, `t`, `area`, `background`, `sum`, `corrected`).

Nontechnical path while Studio is still in dev: Aligner → these notebooks. Power users/agents often crop here (or `lisca-crop`) then run `transfection` analysis separately.

### Install

- macOS / Linux: `bash scripts/install.sh`
- Windows: `.\scripts\install.ps1`

```bash
uv sync --extra notebook
```

### Run notebooks (laptop)

- macOS / Linux: `bash scripts/jupyter-notebook.sh`
- Windows: `.\scripts\jupyter-notebook.ps1`

Opens Jupyter on the `notebooks/` folder (`crop.ipynb`, `analyze.ipynb`).

### JupyterHub

Unpack or copy this folder into your JupyterHub home. Then:

```bash
bash scripts/jupyter-hub.sh
```

Refresh the browser tab (or open JupyterHub again). Open `notebooks/crop.ipynb` (then `analyze.ipynb`). In the Kernel menu, pick **Lisca** if it is not already selected. In the Config cell, set `WORKSPACE` and `SOURCE` to the mounted data folder.

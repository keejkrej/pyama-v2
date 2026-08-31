# Pyama

Desktop app and Python analysis package for microscopy ROI workflows.

- `apps/pyama`: Tauri desktop app (`src/` frontend, `src-tauri` Rust backend)
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
2. **Analyze** (`notebooks/analyze.ipynb`): Config sets `WORKSPACE`, `INTERVAL_MINUTES`, `MAX_ONSET_MINUTES`, `SIGNAL_CHANNEL` — no sample names. Discovers `roi/Pos*` and writes `analysis/Pos{n}/ch{n}.csv`, `auc.csv`, `fit.csv` (CSV only). Merges interval and `analysis.channels` into `assay.json` (does not write `samples[]`).
3. **Results** (`notebooks/results.ipynb`): Config sets sample names + positions, merges `samples[]` into `assay.json` (does not invent the signal channel), and packs `results/<sample>/` (XLSX + single-panel PNG). Re-run plots without repeating analyze.

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

Opens Jupyter on the `notebooks/` folder (`crop.ipynb`, `analyze.ipynb`, `results.ipynb`).

### JupyterHub

Unpack or copy this folder into your JupyterHub home. Then:

```bash
bash scripts/jupyter-hub.sh
```

Refresh the browser tab (or open JupyterHub again). Open `notebooks/crop.ipynb` (then `analyze.ipynb`, then `results.ipynb`). In the Kernel menu, pick **Lisca** if it is not already selected. In the Config cell, set `WORKSPACE` and `SOURCE` to the mounted data folder.

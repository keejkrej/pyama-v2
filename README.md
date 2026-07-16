# Pyama

Desktop app and Python analysis package for microscopy ROI workflows.

- `apps/pyama`: Tauri desktop app (`src/` frontend, `src-tauri/` Rust backend)
- `src/pyama`: Python package for ROI crop, slide mapping, segmentation, timeseries, AUC, and fitting (driven from `notebooks/crop.ipynb` and `notebooks/analyze.ipynb`)

## Tasks

- `bun run build` / `bun run build:pyama`: build the desktop app
- `bun run dev:pyama`: start the desktop app in dev mode
- `bun run dev:pyama-server`: run the Rust server headless (`cargo watch`; install once with `cargo install cargo-watch`)
- `bun run dev:pyama-web`: Vite frontend only
- `bun run test`: run app tests
- `bun run typecheck`: TypeScript typecheck
- `bun run check`: JS typechecks and `cargo check --workspace`

## Desktop app run modes

Browser-based dev UI is **`bun run dev:pyama-web`**. Pair with **`bun run dev:pyama-server`** when you want the RPC server without `tauri dev`.

The packaged `pyama` binary:

- **Default**: WebSocket RPC on `127.0.0.1:3412` plus the native window
- **`server`**: headless WebSocket only (`pyama server [--port <wsPort>] [--lan]`)

## Python analysis

Experiment configuration lives in Jupyter notebooks.

1. **Crop** (`notebooks/crop.ipynb`): ND2/CZI + `bbox/` → `roi/`
2. **Analyze** (`notebooks/analyze.ipynb`): `segment` → `timeseries` → `plot-timeseries` → `auc` → `plot-auc` → `fit` → `plot-fit`

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

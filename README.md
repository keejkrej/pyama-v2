# Pyama

Desktop app and Python analysis package for microscopy ROI workflows.

- `packages/lisca/typescript`: shared TypeScript contracts, state, UI, and host integration
- `packages/lisca/rust`: shared Rust native backend for desktop/viewer operations
- `apps/pyama`: standalone Tauri desktop shell
- `src/pyama`: Python package for ROI crop, slide mapping, segmentation, timeseries, AUC, and fitting (driven from `notebooks/analyze.ipynb`)

## Architecture

- Rust `lisca` provides `lisca::viewer::*` as the native desktop/backend layer.
- TypeScript `lisca` provides `lisca/viewer/*` and `lisca/shared/*` as the frontend layer.

The repository root is workspace-only. TypeScript and Rust packages live at their language-specific package roots. The `pyama` Python package is managed by `uv` and `pyproject.toml`.

## Tasks

The TypeScript workspace uses Turbo for package-aware task orchestration:

- `bun run build`: build every JS workspace package that defines a `build` script
- `bun run build:pyama`: build only the desktop app
- `bun run dev:pyama`: start the desktop app in dev mode
- `bun run dev:pyama-server`: run the Rust server headless (`cargo watch`; install once with `cargo install cargo-watch`)
- `bun run dev:pyama-web`: Vite frontend only
- `bun run test`: run package tests across the JS workspace
- `bun run typecheck`: run `typecheck` across the JS workspace
- `bun run check`: run JS typechecks and `cargo check --workspace`

## Desktop app run modes

Browser-based dev UI is **`bun run dev:pyama-web`** (Vite only)—not a Rust flag. Pair it with **`bun run dev:pyama-server`** when you want the RPC server without `tauri dev`.

The packaged `pyama` binary exposes the same CLI:

- **Default** (no subcommand): local WebSocket RPC on `127.0.0.1:3412` (or `LISCA_WEBSOCKET_ADDR` / `LISCA_WEBSOCKET_URL`) plus the native window.
- **`server`**: headless process; WebSocket only. Usage: `pyama server [--port <wsPort>] [--lan]`. Default listen port is 3412. **`--lan` binds `0.0.0.0`** and exposes RPC on the network—use only on trusted LANs or with additional protection.

**Split dev:** `dev:web` is Vite. `dev:server` runs `cargo watch … server --lan` inside `src-tauri` so Rust edits rebuild like `tauri dev`. Requires [cargo-watch](https://github.com/watchexec/cargo-watch) (`cargo install cargo-watch`). Pair with `dev:pyama-web` from the repo root as needed.

Rust remains managed by Cargo directly via `bun run check:rust` or plain `cargo` commands.

## Python analysis (`pyama`)

Experiment configuration (source path, slide mapping, interval, jobs, etc.) lives in a Jupyter notebook; the package exports reusable `core` and `services` code.

Pipeline: `crop` → `segment` → `timeseries` → `plot-timeseries` → `auc` → `plot-auc` → `fit` → `plot-fit`

### Install

From the repo root, run the platform-specific install script. It downloads `uv` if missing, creates a virtual environment, and installs the package (including local `../mdat-py` for ND2/CZI IO).

- macOS / Linux:
  ```bash
  bash scripts/install.sh
  ```
- Windows:
  ```powershell
  .\scripts\install.ps1
  ```

For notebook use, also install the optional extras:

```bash
uv sync --extra notebook
```

### Run analysis

Start Jupyter with the analysis notebook:

- macOS / Linux: `bash scripts/notebook.sh`
- Windows: `.\scripts\notebook.ps1`

Then edit the **Config** cell and run the pipeline cells in order.

Optional: set `WRITE_SLIDE_JSON = True` to persist the in-notebook mapping as `slide.json` under the workspace.

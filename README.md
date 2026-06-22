# LISCA Viewer

This repository contains the LISCA desktop viewer application, the shared libraries it depends on, and the `transfection` Python package for microscopy ROI extraction and timeseries analysis.

- `packages/lisca/typescript`: shared TypeScript viewer contracts, state, UI, and host integration
- `packages/lisca/rust`: shared Rust native backend for viewer workflows
- `apps/viewer`: standalone Tauri viewer shell
- `src/transfection`: Python package for slide mapping, segmentation masks, timeseries metrics, AUC, and curve fitting

## Architecture

- Rust `lisca` provides `lisca::viewer::*` as the native desktop/backend layer for viewer operations.
- TypeScript `lisca` provides `lisca/viewer/*` and `lisca/shared/*` as the frontend/viewer layer.

The repository root is workspace-only. TypeScript and Rust packages live at their language-specific package roots. The `transfection` package is managed by `uv` and `pyproject.toml`.

## Tasks

The TypeScript workspace uses Turbo for package-aware task orchestration:

- `bun run build`: build every JS workspace package that defines a `build` script
- `bun run build:viewer`: build only the viewer app
- `bun run dev:viewer`: start the viewer app in dev mode
- `bun run dev:viewer-server`: run the viewer Rust server headless (`cargo watch`; install once with `cargo install cargo-watch`)
- `bun run dev:viewer-web`: Vite frontend only
- `bun run test`: run package tests across the JS workspace
- `bun run typecheck`: run `typecheck` across the JS workspace
- `bun run check`: run JS typechecks and `cargo check --workspace`

## Desktop app run modes

Browser-based dev UI is **`bun run dev:viewer-web`** (Vite only)—not a Rust flag. Pair it with **`bun run dev:viewer-server`** when you want the RPC server without `tauri dev`.

The packaged `viewer` binary exposes the same CLI:

- **Default** (no subcommand): local WebSocket RPC on `127.0.0.1:3412` (or `LISCA_WEBSOCKET_ADDR` / `LISCA_WEBSOCKET_URL`) plus the native window.
- **`server`**: headless process; WebSocket only. Usage: `viewer server [--port <wsPort>] [--lan]`. Default listen port is 3412. **`--lan` binds `0.0.0.0`** and exposes RPC on the network—use only on trusted LANs or with additional protection.

**Split dev:** `dev:web` is Vite. `dev:server` runs `cargo watch … server --lan` inside `src-tauri` so Rust edits rebuild like `tauri dev`. Requires [cargo-watch](https://github.com/watchexec/cargo-watch) (`cargo install cargo-watch`). Pair with `dev:viewer-web` from the repo root as needed.

Rust remains managed by Cargo directly via `bun run check:rust` or plain `cargo` commands.

## transfection

`transfection` is a Python CLI for processing microscopy datasets.

Pipeline: `slide` → `segment` → `timeseries` → `plot-timeseries` → `auc` → `plot-auc` → `fit` → `plot-fit`

### Install

From the repo root, run the platform-specific install script. It downloads `uv` if missing, creates a virtual environment, and installs the package.

- macOS / Linux:
  ```bash
  bash scripts/install.sh
  ```
- Windows:
  ```powershell
  .\scripts\install.ps1
  ```

### Run the CLI

After install, run commands with `uv`:

```bash
uv run transfection --help
```

### Interactive scripts

For convenience, two interactive shell scripts walk through common pipelines:

- `bash scripts/transfection-slide.sh` — build a `slide.json` channel mapping file.
- `bash scripts/transfection-analyze.sh` — run the full analysis pipeline on a dataset.

Windows equivalents are `scripts/transfection-slide.ps1` and `scripts/transfection-analyze.ps1`.

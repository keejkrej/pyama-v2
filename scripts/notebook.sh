#!/usr/bin/env bash
# Start Jupyter with notebooks/analyze.ipynb
# Dev: from repo root, run: bash scripts/notebook.sh
# Prod (transfection.zip): run from extracted bundle root after install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/../pyproject.toml" ]]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [[ -f "$SCRIPT_DIR/pyproject.toml" ]]; then
  REPO_ROOT="$SCRIPT_DIR"
else
  echo "Run this script from the repo root (next to pyproject.toml) or from an extracted transfection bundle root." >&2
  exit 1
fi

if [[ -x "$REPO_ROOT/.uv/uv.exe" ]]; then
  UV_EXE="$REPO_ROOT/.uv/uv.exe"
elif [[ -x "$REPO_ROOT/.uv/uv" ]]; then
  UV_EXE="$REPO_ROOT/.uv/uv"
elif command -v uv >/dev/null 2>&1; then
  UV_EXE="uv"
else
  echo "Neither $REPO_ROOT/.uv/uv.exe, $REPO_ROOT/.uv/uv, nor uv on PATH was found. Run install.sh or install uv." >&2
  exit 1
fi

NOTEBOOK="$REPO_ROOT/notebooks/analyze.ipynb"
if [[ ! -f "$NOTEBOOK" ]]; then
  echo "Notebook not found: $NOTEBOOK" >&2
  exit 1
fi

cd "$REPO_ROOT"
exec "$UV_EXE" run --python 3.12 --extra notebook jupyter notebook "$NOTEBOOK"

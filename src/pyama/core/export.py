from __future__ import annotations

from pathlib import Path

import pandas as pd

XLSX_EXTENSION = ".xlsx"
# openpyxl / Excel worksheet hard limit (pandas raises above this).
EXCEL_MAX_ROWS = 1_048_576


def parallel_xlsx_path(csv_path: Path) -> Path:
    return csv_path.with_suffix(XLSX_EXTENSION)


def write_csv(df: pd.DataFrame, output_csv: Path) -> Path:
    """Write a CSV only (analysis/ artifacts). Never writes XLSX."""
    output_csv = output_csv.resolve()
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_csv, index=False)
    return output_csv


def write_xlsx(df: pd.DataFrame, output_xlsx: Path) -> Path | None:
    """Write an XLSX only (results/<sample>/ tables). Never writes CSV.

    Returns the path when written, or None when the frame exceeds the Excel row limit.
    """
    output_xlsx = output_xlsx.resolve()
    output_xlsx.parent.mkdir(parents=True, exist_ok=True)
    if len(df) > EXCEL_MAX_ROWS:
        if output_xlsx.is_file():
            output_xlsx.unlink()
        return None
    df.to_excel(output_xlsx, index=False, engine="openpyxl")
    return output_xlsx

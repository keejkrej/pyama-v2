from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

XLSX_EXTENSION = ".xlsx"
# openpyxl / Excel worksheet hard limit (pandas raises above this).
EXCEL_MAX_ROWS = 1_048_576


def parallel_xlsx_path(csv_path: Path) -> Path:
    return csv_path.with_suffix(XLSX_EXTENSION)


def write_csv_and_parallel_xlsx(df: pd.DataFrame, output_csv: Path) -> Path | None:
    """Write CSV always; write sibling XLSX only when within Excel sheet limits.

    Returns the XLSX path when written, otherwise None.
    """
    output_csv = output_csv.resolve()
    output_xlsx = parallel_xlsx_path(output_csv)
    output_csv.parent.mkdir(parents=True, exist_ok=True)

    def write_csv() -> None:
        df.to_csv(output_csv, index=False)

    if len(df) > EXCEL_MAX_ROWS:
        write_csv()
        if output_xlsx.is_file():
            output_xlsx.unlink()
        return None

    def write_xlsx() -> None:
        df.to_excel(output_xlsx, index=False, engine="openpyxl")

    with ThreadPoolExecutor(max_workers=2) as executor:
        csv_future = executor.submit(write_csv)
        xlsx_future = executor.submit(write_xlsx)
        csv_future.result()
        xlsx_future.result()

    return output_xlsx

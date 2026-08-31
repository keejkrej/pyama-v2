# Pyama

Desktop app and Python analysis package for microscopy ROI workflows. Pyama aligns a grid over ND2/CZI frames and writes workspace artifacts; `crop.ipynb` performs ROI cropping, `analyze.ipynb` writes sample-agnostic `analysis/` CSVs, and `results.ipynb` packs per-sample plots and tables.

**With LiSCA:** Aligner is the light grid/bbox shell (short-lived webapp). **ROI crop’s Python goal source is this repo** (`pyama.services.crop`, `notebooks/crop.ipynb`). Transfection analysis CLI for agents often continues in `lisca-transfection-assay`. Studio owns end-to-end for nontechnical users when ready; until then Aligner + these notebooks is the less error-prone path (no long-running jobs in the align webapp).

## Language

### Workspace & sources

**Workspace**:
The root folder that holds ROI workflow artifacts (`bbox/`, `align/`, and later analysis outputs).
_Avoid_: project root, experiment folder, data directory

**Source**:
An ND2 or CZI image file opened in Pyama.
_Avoid_: image, file, dataset (when meaning the microscopy file)

**Scan**:
The available dimension indices for a Source (positions, channels, times, z-slices).
_Avoid_: metadata, dimensions list

**Selection**:
The current (pos, channel, time, z) index into a Source.
_Avoid_: frame index, coordinates (when meaning dimension indices)

**Frame**:
The pixel buffer for one Selection, plus contrast windows.
_Avoid_: image, slice (when meaning the loaded pixel result)

### Grid & exclusions

**Grid**:
The overlay lattice (shape, spacing, cell size, opacity, transform) used to define ROI cells on a Frame.
_Avoid_: mesh, lattice (as primary term)

**Excluded cells**:
The set of Grid cell coordinates `(i, j)` omitted from bbox export for a position.
_Avoid_: deselected ROIs, hidden cells

**Auto-exclude**:
Flatness scoring of visible included cells with a threshold preview used to exclude weak cells.
_Avoid_: auto-filter, quality gate

### Workspace artifacts

**BBox CSV**:
Per-position ROI rectangles written as `bbox/Pos{n}.csv`.
_Avoid_: ROI file, crop table

**Align state**:
Per-position Grid plus excluded cells persisted as `align/Pos{n}.json`.
_Avoid_: SavedState, SavedAlignState, session JSON

### Host seam

**HostApi**:
The Tauri IPC surface for loading frames, scans, align state, saving bbox outputs, and host filesystem helpers (directory listing, home, read text).
_Avoid_: DataPort, HostPort, backend API, RPC client (as the domain name)

### Python analysis chain

**ROI**:
A cropped region derived from BBox CSV entries for downstream analysis.
On disk: `roi/Pos{n}/` with slim `index.json` — always `axisOrder: "TCZYX"`, keep `zCount` (use `1` if no z-stack); stack shape derived from counts + `bbox` (no per-ROI `shape`, no `source` / `pageOrder`).
_Avoid_: crop (as the noun for the region itself — use for the crop step)

**Timeseries**:
Per-ROI intensity (or derived) values across time.
The timeseries **stage** writes CSV only under `analysis/Pos{n}/ch{n}.csv` (never XLSX; never `timeseries/`).
Columns: `roi`, `t`, `area`, `background`, `sum`, `corrected` (`t` from `index.json` `timeIndices`). `analyze.ipynb` is sample-agnostic: it discovers `roi/Pos*` and uses one `SIGNAL_CHANNEL` (int, zero-based) for every Pos. Sample names and per-sample signal maps are not written here.
`results.ipynb` packs each sample to `results/{sample}/traces.xlsx` plus single-panel `traces.png` / `traces_summary.png` (mean/median/IQR) / `area.png`, and shared-y companions `traces_shared_y.png` / `traces_summary_shared_y.png` / `area_shared_y.png` (same traces; ylim pooled across samples). No `traces.csv` under `results/`. No `area_summary.png`. `{sample}` is the filesystem-safe Config `SAMPLES[].name`.
_Avoid_: trace, curve (as primary term)

**AUC**:
Area-under-curve summary computed from a Timeseries.
Per-position CSV: `analysis/Pos{n}/auc.csv` (columns `pos`, `roi`, `auc`). No combined `results/auc.csv`.
User-facing pack: `results/{sample}/auc.xlsx` (no per-sample `auc.csv` or `auc.png`). Cross-sample boxplot `results/auc.png` (samples on x, linear). No `auc_log.png`.
_Avoid_: integral score

**Fit**:
Parametric model fit applied to a Timeseries.
Per-position CSV: `analysis/Pos{n}/fit.csv` (kinetic columns include `translation_onset`). No combined `results/fit.csv`.
User-facing pack: `results/{sample}/fit.xlsx` plus `traces_fit.png`, `traces_fit_shared_y.png` (same traces; ylim pooled across samples), and `expression_rate_vs_onset.png` (single-panel scatter of `translation_onset` vs `expression_rate`, r and n on the panel; not a subplot grid, not at `results/` root). No per-sample `fit.csv`. Parameter boxplots (`baseline_intensity.png`, `protein_lifetime.png`, `mrna_lifetime.png`, `onset_time.png`, `expression_rate.png`) are written once at `results/` root (samples on x, linear). No `expression_rate_log.png`.
_Avoid_: regression (as primary term)

**Assay JSON**:
Both notebooks merge into `workspace/assay.json` (create if missing; never clobber the other notebook’s keys). `analyze.ipynb` writes `type` (new file), `interval`, `analysis.maxOnsetMinutes`, `analysis.skipSegment` (true; this package has no segmentation step), and `analysis.channels` (`signal` as the one-element list `[SIGNAL_CHANNEL]`, `mask` 0; no mask Config). It does not write `samples[]` or `sampleChannels`. `results.ipynb` writes `samples[]` (`name`, `positions`, `slideChannel`). If `analysis.channels.signal` is missing, it may write that key as a one-element list from analyze / `analysis/PosN/ch*.csv`. It does not invent a Config `SIGNAL_CHANNEL` and does not write `sampleChannels`. Flexible multi-channel `signal` lists and per-slideChannel `sampleChannels` overrides live only in `assay.json` for Studio / lisca-analyze. Prefer analyze first, then results.

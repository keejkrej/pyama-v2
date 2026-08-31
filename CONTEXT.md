# Pyama

Desktop app and Python analysis package for microscopy ROI workflows. Pyama aligns a grid over ND2/CZI frames and writes workspace artifacts; `crop.ipynb` performs ROI cropping and the analysis notebook runs unsegmented timeseries, AUC, and fit.

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
Tables are stored per position and signal channel at `timeseries/Pos{n}/ch{n}.csv` with a parallel `.xlsx` file.
Columns: `roi`, `t`, `area`, `background`, `sum`, `corrected` (`t` from `index.json` `timeIndices`; slide join key comes from the notebook `SLIDE_MAPPING`, not `assay.json`).
After those CSVs exist, each sample also gets a long `results/samples/<sample>/traces.csv` (and `.xlsx`) with `slide_channel,sample,pos,roi,t,area,background,sum,corrected`. `<sample>` is the filesystem-safe `SLIDE_MAPPING` `sample_name`.
_Avoid_: trace, curve (as primary term)

**AUC**:
Area-under-curve summary computed from a Timeseries.
Combined table: `results/auc.csv`. Each sample also gets its rows at `results/samples/<sample>/auc.csv` (and `.xlsx`).
_Avoid_: integral score

**Fit**:
Parametric model fit applied to a Timeseries or AUC result.
Combined table: `results/fit.csv` (kinetic columns include `translation_onset`). Each sample also gets its rows at `results/samples/<sample>/fit.csv` (and `.xlsx`).
_Avoid_: regression (as primary term)

# Pyama

Desktop app and Python analysis package for microscopy ROI workflows. Pyama aligns a grid over ND2/CZI frames and writes workspace artifacts; the Python package consumes those artifacts for crop, segment, timeseries, AUC, and fit.

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
_Avoid_: crop (as the noun for the region itself — use for the crop step)

**Timeseries**:
Per-ROI intensity (or derived) values across time.
_Avoid_: trace, curve (as primary term)

**AUC**:
Area-under-curve summary computed from a Timeseries.
_Avoid_: integral score

**Fit**:
Parametric model fit applied to a Timeseries or AUC result.
_Avoid_: regression (as primary term)

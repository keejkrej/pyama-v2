use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WorkspaceScan {
    pub positions: Vec<u32>,
    pub channels: Vec<u32>,
    pub times: Vec<u32>,
    #[serde(rename = "zSlices")]
    pub z_slices: Vec<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ViewerSource {
    Nd2 { path: String },
    Czi { path: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct FrameRequest {
    pub pos: u32,
    pub channel: u32,
    pub time: u32,
    pub z: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GridShape {
    Square,
    Hex,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GridState {
    pub enabled: bool,
    pub shape: GridShape,
    pub tx: f64,
    pub ty: f64,
    pub rotation: f64,
    pub spacing_a: f64,
    pub spacing_b: f64,
    pub cell_width: f64,
    pub cell_height: f64,
    pub opacity: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GridCellCoord {
    pub i: i32,
    pub j: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAlignState {
    pub grid: GridState,
    pub excluded_cells: Vec<GridCellCoord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ContrastWindow {
    pub min: u32,
    pub max: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoExcludePreviewCell {
    pub i: i32,
    pub j: i32,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoExcludePreviewRequest {
    pub source: ViewerSource,
    pub selection: FrameRequest,
    pub cells: Vec<AutoExcludePreviewCell>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoExcludePreviewCellScore {
    pub i: i32,
    pub j: i32,
    pub score: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoExcludeHistogramBin {
    pub start: f64,
    pub end: f64,
    pub count: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoExcludePreviewResponse {
    pub eligible_cell_count: u32,
    pub cell_scores: Vec<AutoExcludePreviewCellScore>,
    pub histogram_bins: Vec<AutoExcludeHistogramBin>,
    pub score_min: f64,
    pub score_max: f64,
    pub threshold: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SaveBboxResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn parse_pos_dir_name(name: &str) -> Option<u32> {
    let normalized: String = name.chars().filter(|c| !c.is_whitespace()).collect();
    if normalized.is_empty() {
        return None;
    }

    let lower = normalized.to_ascii_lowercase();
    for prefix in ["position", "pos"] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            let trimmed = rest.trim_start_matches(['-', '_']);
            if !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit()) {
                return trimmed.parse().ok();
            }
        }
    }

    if lower.chars().all(|c| c.is_ascii_digit()) {
        return lower.parse().ok();
    }

    None
}

pub fn parse_bbox_csv_name(name: &str) -> Option<u32> {
    let lower = name.to_ascii_lowercase();
    let stem = lower.strip_suffix(".csv")?;
    parse_pos_dir_name(stem)
}


pub fn workspace_bbox_csv_path(root: &str, pos: u32) -> PathBuf {
    Path::new(root).join("bbox").join(format!("Pos{pos}.csv"))
}

pub fn workspace_align_json_path(root: &str, pos: u32) -> PathBuf {
    Path::new(root).join("align").join(format!("Pos{pos}.json"))
}

pub fn dimension_size(sizes: &HashMap<String, usize>, key: &str) -> usize {
    sizes.get(key).copied().unwrap_or(1)
}

pub fn dimension_values(sizes: &HashMap<String, usize>, key: &str) -> Vec<u32> {
    (0..dimension_size(sizes, key))
        .filter_map(|value| u32::try_from(value).ok())
        .collect()
}

pub fn validate_request_index(label: &str, index: u32, size: usize) -> Result<usize, String> {
    let effective_size = size.max(1);
    let index = index as usize;
    if index >= effective_size {
        return Err(format!("{label} index {index} is out of range"));
    }
    Ok(index)
}


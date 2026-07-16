use std::collections::HashMap;
use std::path::Path;

use czi_rs::CziFile;
use nd2_rs::Nd2File;

use crate::domain::{
    dimension_size, dimension_values, validate_request_index, ContrastWindow, FrameRequest,
    Source, WorkspaceScan,
};

const SAMPLE_SIZE: usize = 2048;

#[derive(Clone, Debug)]
pub struct RawFrame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u16>,
    pub contrast_domain: ContrastWindow,
}

#[derive(Clone, Debug)]
pub struct SourceMetadata {
    pub width: u32,
    pub height: u32,
    pub positions: Vec<u32>,
    pub channels: Vec<u32>,
    pub times: Vec<u32>,
    pub z_slices: Vec<u32>,
}

impl SourceMetadata {
    pub fn workspace_scan(&self) -> WorkspaceScan {
        WorkspaceScan {
            positions: self.positions.clone(),
            channels: self.channels.clone(),
            times: self.times.clone(),
            z_slices: self.z_slices.clone(),
        }
    }

    pub fn contains_position(&self, pos: u32) -> bool {
        self.positions.contains(&pos)
    }

    pub fn position_index(&self, pos: u32) -> Result<usize, String> {
        validate_request_index("Position", pos, self.positions.len())
    }

    pub fn time_index(&self, time: u32) -> Result<usize, String> {
        validate_request_index("Time", time, self.times.len())
    }

    pub fn channel_index(&self, channel: u32) -> Result<usize, String> {
        validate_request_index("Channel", channel, self.channels.len())
    }

    pub fn z_index(&self, z: u32) -> Result<usize, String> {
        validate_request_index("Z", z, self.z_slices.len())
    }

    pub fn indices_for_request(
        &self,
        request: &FrameRequest,
    ) -> Result<(usize, usize, usize, usize), String> {
        Ok((
            self.position_index(request.pos)?,
            self.time_index(request.time)?,
            self.channel_index(request.channel)?,
            self.z_index(request.z)?,
        ))
    }
}

pub enum SourceReader {
    Nd2(Nd2File),
    Czi(CziFile),
}

impl SourceReader {
    pub fn open_nd2(path: &Path) -> Result<Self, String> {
        Ok(Self::Nd2(
            Nd2File::open(path).map_err(|err| err.to_string())?,
        ))
    }

    pub fn open_czi(path: &Path) -> Result<Self, String> {
        Ok(Self::Czi(
            CziFile::open(path).map_err(|err| err.to_string())?,
        ))
    }

    pub fn metadata(&mut self) -> Result<SourceMetadata, String> {
        match self {
            Self::Nd2(reader) => {
                let summary = reader.summary().map_err(|err| err.to_string())?;
                let sizes: HashMap<String, usize> = summary.sizes.into_iter().collect();
                metadata_from_sizes(&sizes, "P")
            }
            Self::Czi(reader) => {
                let summary = reader.summary().map_err(|err| err.to_string())?;
                let sizes: HashMap<String, usize> = summary.sizes.into_iter().collect();
                metadata_from_sizes(&sizes, "S")
            }
        }
    }

    pub fn read_frame_2d(
        &mut self,
        pos: usize,
        time: usize,
        channel: usize,
        z: usize,
    ) -> Result<RawFrame, String> {
        match self {
            Self::Nd2(reader) => {
                let data = reader
                    .read_frame_2d(pos, time, channel, z)
                    .map_err(|err| err.to_string())?;
                let summary = reader.summary().map_err(|err| err.to_string())?;
                let sizes: HashMap<String, usize> = summary.sizes.into_iter().collect();
                let width =
                    u32::try_from(dimension_size(&sizes, "X")).map_err(|err| err.to_string())?;
                let height =
                    u32::try_from(dimension_size(&sizes, "Y")).map_err(|err| err.to_string())?;
                Ok(RawFrame {
                    width,
                    height,
                    data,
                    contrast_domain: ContrastWindow {
                        min: 0,
                        max: u16::MAX as u32,
                    },
                })
            }
            Self::Czi(reader) => {
                let data = reader
                    .read_frame_2d(pos, time, channel, z)
                    .map_err(|err| err.to_string())?;
                let summary = reader.summary().map_err(|err| err.to_string())?;
                let sizes: HashMap<String, usize> = summary.sizes.into_iter().collect();
                let width =
                    u32::try_from(dimension_size(&sizes, "X")).map_err(|err| err.to_string())?;
                let height =
                    u32::try_from(dimension_size(&sizes, "Y")).map_err(|err| err.to_string())?;
                Ok(RawFrame {
                    width,
                    height,
                    data,
                    contrast_domain: ContrastWindow {
                        min: 0,
                        max: u16::MAX as u32,
                    },
                })
            }
        }
    }
}

fn metadata_from_sizes(
    sizes: &HashMap<String, usize>,
    position_key: &str,
) -> Result<SourceMetadata, String> {
    Ok(SourceMetadata {
        width: u32::try_from(dimension_size(sizes, "X")).map_err(|err| err.to_string())?,
        height: u32::try_from(dimension_size(sizes, "Y")).map_err(|err| err.to_string())?,
        positions: dimension_values(sizes, position_key),
        channels: dimension_values(sizes, "C"),
        times: dimension_values(sizes, "T"),
        z_slices: dimension_values(sizes, "Z"),
    })
}

pub fn scan_nd2(path: &Path) -> Result<WorkspaceScan, String> {
    let mut reader = SourceReader::open_nd2(path)?;
    Ok(reader.metadata()?.workspace_scan())
}

pub fn scan_czi(path: &Path) -> Result<WorkspaceScan, String> {
    let mut reader = SourceReader::open_czi(path)?;
    Ok(reader.metadata()?.workspace_scan())
}



pub fn load_nd2_frame(path: &Path, request: FrameRequest) -> Result<RawFrame, String> {
    let mut reader = SourceReader::open_nd2(path)?;
    let metadata = reader.metadata()?;
    let (pos, time, channel, z) = metadata.indices_for_request(&request)?;
    reader.read_frame_2d(pos, time, channel, z)
}

pub fn load_czi_frame(path: &Path, request: FrameRequest) -> Result<RawFrame, String> {
    let mut reader = SourceReader::open_czi(path)?;
    let metadata = reader.metadata()?;
    let (pos, time, channel, z) = metadata.indices_for_request(&request)?;
    reader.read_frame_2d(pos, time, channel, z)
}

pub fn scan_source(source: Source) -> Result<WorkspaceScan, String> {
    match source {
        Source::Nd2 { path } => scan_nd2(Path::new(&path)),
        Source::Czi { path } => scan_czi(Path::new(&path)),
    }
}

pub fn load_frame(source: Source, request: FrameRequest) -> Result<RawFrame, String> {
    match source {
        Source::Nd2 { path } => load_nd2_frame(Path::new(&path), request),
        Source::Czi { path } => load_czi_frame(Path::new(&path), request),
    }
}

fn sampled_values(values: &[u16]) -> Vec<u16> {
    if values.is_empty() {
        return vec![0];
    }

    if values.len() <= SAMPLE_SIZE {
        let mut copy = values.to_vec();
        copy.sort_unstable();
        return copy;
    }

    let step = values.len() as f64 / SAMPLE_SIZE as f64;
    let mut sample = Vec::with_capacity(SAMPLE_SIZE);
    for index in 0..SAMPLE_SIZE {
        let position = (index as f64 * step).floor() as usize;
        sample.push(values[position.min(values.len() - 1)]);
    }
    sample.sort_unstable();
    sample
}

fn percentile(values: &[u16], q: f64) -> u16 {
    if values.is_empty() {
        return 0;
    }

    let sorted = sampled_values(values);
    let clamped_q = q.clamp(0.0, 1.0);
    let index = (clamped_q * (sorted.len().saturating_sub(1)) as f64).floor() as usize;
    sorted[index.min(sorted.len() - 1)]
}

pub fn auto_contrast(values: &[u16]) -> ContrastWindow {
    if values.is_empty() {
        return ContrastWindow { min: 0, max: 1 };
    }

    let min = percentile(values, 0.001) as u32;
    let max = percentile(values, 0.999) as u32;
    ContrastWindow {
        min,
        max: max.max(min + 1),
    }
}

pub fn normalize_contrast(contrast: &ContrastWindow, domain: &ContrastWindow) -> ContrastWindow {
    let min = contrast.min.clamp(domain.min, domain.max.saturating_sub(1));
    let max = contrast.max.clamp(min + 1, domain.max);
    ContrastWindow { min, max }
}

pub fn apply_contrast(values: &[u16], contrast: &ContrastWindow) -> Vec<u8> {
    let min = contrast.min as f32;
    let max = contrast.max.max(contrast.min + 1) as f32;
    let range = (max - min).max(1.0);

    values
        .iter()
        .map(|value| {
            let normalized = ((*value as f32 - min) / range).clamp(0.0, 1.0);
            (normalized * 255.0).round() as u8
        })
        .collect()
}

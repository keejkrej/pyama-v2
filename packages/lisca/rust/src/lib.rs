//! Rust pipeline layer for LISCA native workflows.
//!
//! The crate currently exposes the native `viewer` backend plus shared
//! data loading and analysis helpers used by the viewer backend.

pub mod analysis;
pub mod data;
pub mod host_fs;
#[cfg(feature = "viewer")]
pub mod viewer;

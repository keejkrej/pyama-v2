#![cfg_attr(target_os = "windows", windows_subsystem = "console")]

#[cfg(target_os = "linux")]
use std::path::Path;
#[cfg(target_os = "linux")]
use std::env;

use pyama::backend::{
    auto_exclude_preview as run_auto_exclude_preview,
    list_saved_bbox_positions as run_list_saved_bbox_positions,
    load_align_state as run_load_align_state, load_frame_payload, save_bbox as run_save_bbox,
    scan_source as run_scan_source, AutoExcludePreviewRequest, AutoExcludePreviewResponse,
    ContrastWindow, FramePayload, FrameRequest, SaveBboxResponse, AlignState, Source,
    WorkspaceScan,
};
use pyama::host_fs::{self, HostListDirectoryResult};
use tauri::command;

#[command]
fn scan_source(source: Source) -> Result<WorkspaceScan, String> {
    run_scan_source(source)
}

#[command]
fn load_frame(
    source: Source,
    request: FrameRequest,
    contrast: Option<ContrastWindow>,
) -> Result<FramePayload, String> {
    load_frame_payload(source, request, contrast)
}

#[command]
fn list_saved_bbox_positions(workspace_path: String) -> Result<Vec<u32>, String> {
    run_list_saved_bbox_positions(workspace_path)
}

#[command]
fn load_align_state(workspace_path: String, pos: u32) -> Result<Option<AlignState>, String> {
    run_load_align_state(workspace_path, pos)
}

#[command]
fn auto_exclude_preview(
    request: AutoExcludePreviewRequest,
) -> Result<AutoExcludePreviewResponse, String> {
    run_auto_exclude_preview(request)
}

#[command]
fn save_bbox(
    workspace_path: String,
    pos: u32,
    csv: String,
    align_state: AlignState,
) -> SaveBboxResponse {
    run_save_bbox(workspace_path, pos, csv, align_state)
}

#[command]
fn list_directory(path: Option<String>) -> Result<HostListDirectoryResult, String> {
    host_fs::list_directory(path)
}

#[command]
fn user_home_directory() -> Result<String, String> {
    host_fs::user_home_directory()
}

#[command]
fn read_text_file(path: String) -> Result<String, String> {
    host_fs::read_text_file(path)
}

fn main() {
    apply_linux_webkit_workarounds();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_source,
            load_frame,
            list_saved_bbox_positions,
            load_align_state,
            auto_exclude_preview,
            save_bbox,
            list_directory,
            user_home_directory,
            read_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn apply_linux_webkit_workarounds() {
    #[cfg(target_os = "linux")]
    {
        if !linux_has_nvidia_gpu() {
            return;
        }

        match env::var("XDG_SESSION_TYPE").as_deref() {
            Ok("wayland") => {
                if env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
                    env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
                }
            }
            Ok("x11") => {
                if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
                    env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                }
            }
            _ => {}
        }
    }
}

#[cfg(target_os = "linux")]
fn linux_has_nvidia_gpu() -> bool {
    if Path::new("/sys/module/nvidia").exists() {
        return true;
    }

    let Ok(entries) = std::fs::read_dir("/sys/class/drm") else {
        return false;
    };

    entries.filter_map(Result::ok).any(|entry| {
        let vendor_path = entry.path().join("device/vendor");
        std::fs::read_to_string(vendor_path)
            .map(|vendor| vendor.trim().eq_ignore_ascii_case("0x10de"))
            .unwrap_or(false)
    })
}

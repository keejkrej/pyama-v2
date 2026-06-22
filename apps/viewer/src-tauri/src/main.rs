#![cfg_attr(target_os = "windows", windows_subsystem = "console")]

mod cli_launch;

use std::{
    collections::HashSet,
    env,
    net::TcpListener,
    path::Path,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use clap::Parser;
use lisca::host_fs;
use lisca::viewer::backend::{
    auto_exclude_preview as run_auto_exclude_preview, crop_roi as run_crop_roi,
    list_saved_bbox_positions as run_list_saved_bbox_positions,
    load_align_state as run_load_align_state, load_annotation_labels as run_load_annotation_labels,
    load_frame_payload, load_roi_frame_annotation as run_load_roi_frame_annotation,
    load_roi_frame_payload, save_annotation_labels as run_save_annotation_labels,
    save_bbox as run_save_bbox, save_roi_frame_annotation as run_save_roi_frame_annotation,
    scan_roi_workspace as run_scan_roi_workspace, scan_source as run_scan_source, AnnotationLabel,
    AutoExcludePreviewRequest, AutoExcludePreviewResponse, ContrastWindow, CropOutputFormat,
    CropRoiResponse, CropRoiStatus, FramePayload, FrameRequest, LoadedRoiFrameAnnotation,
    RoiFrameAnnotation, RoiFrameAnnotationPayload as BackendRoiFrameAnnotationPayload, RoiFrameRequest,
    RoiWorkspaceScan,
    SaveBboxResponse, SavedAlignState, ViewerSource, WorkspaceScan,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{command, Emitter, State, WebviewWindow};
use cli_launch::{server_listen_addr, Cli, CliCommand};
use tungstenite::{accept, Message};

const WEBSOCKET_DEFAULT_ADDR: &str = "127.0.0.1:3412";
const CROP_PROGRESS_EVENT: &str = "viewer://crop-progress";

#[derive(Deserialize)]
struct RpcRequest {
    id: String,
    method: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Serialize)]
struct RpcResponse {
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct RpcEvent {
    event: String,
    payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanSourcePayload {
    source: ViewerSource,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePayload {
    workspace_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePosPayload {
    workspace_path: String,
    pos: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadFramePayload {
    source: ViewerSource,
    request: FrameRequest,
    contrast: Option<ContrastWindow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoExcludePreviewPayload {
    request: AutoExcludePreviewRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LabelListPayload {
    workspace_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LabelSavePayload {
    workspace_path: String,
    labels: Vec<AnnotationLabel>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoiFramePayload {
    workspace_path: String,
    request: RoiFrameRequest,
    contrast: Option<ContrastWindow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoiFrameAnnotationRequestPayload {
    workspace_path: String,
    request: RoiFrameRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRoiFramePayload {
    workspace_path: String,
    request: RoiFrameRequest,
    annotation: BackendRoiFrameAnnotationPayload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveBboxPayload {
    workspace_path: String,
    pos: u32,
    csv: String,
    align_state: SavedAlignState,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CropPayload {
    workspace_path: String,
    source: ViewerSource,
    pos: u32,
    format: CropOutputFormat,
    batch: Option<usize>,
    #[serde(rename = "requestId")]
    request_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelCropPayload {
    #[serde(rename = "requestId")]
    request_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListDirectoryPayload {
    path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadTextFilePayload {
    path: String,
}

#[derive(Clone, serde::Serialize)]
struct CropRoiProgress {
    request_id: String,
    progress: f64,
    message: String,
}

#[derive(Default)]
struct CropCancellationRegistry {
    cancelled: Mutex<HashSet<String>>,
}

impl CropCancellationRegistry {
    fn cancel(&self, request_id: &str) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.insert(request_id.to_string());
        }
    }

    fn is_cancelled(&self, request_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|cancelled| cancelled.contains(request_id))
            .unwrap_or(false)
    }

    fn clear(&self, request_id: &str) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.remove(request_id);
        }
    }
}

fn websocket_listen_address() -> String {
    let configured = env::var("LISCA_WEBSOCKET_URL")
        .or_else(|_| env::var("LISCA_WEBSOCKET_ADDR"))
        .unwrap_or_else(|_| WEBSOCKET_DEFAULT_ADDR.to_string());

    let trimmed = configured.trim();
    if trimmed.is_empty() {
        return WEBSOCKET_DEFAULT_ADDR.to_string();
    }

    let address = match trimmed {
        value if value.starts_with("ws://") => &value[5..],
        value if value.starts_with("wss://") => &value[6..],
        value => value,
    };
    address.split('/').next().unwrap_or(address).to_string()
}

fn spawn_websocket_server(registry: Arc<CropCancellationRegistry>, listen_addr: String) {
    let listener = match TcpListener::bind(&listen_addr) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Failed to bind websocket listener on {listen_addr}: {error}");
            return;
        }
    };

    thread::spawn(move || {
        for stream in listener.incoming() {
            let registry = Arc::clone(&registry);
            match stream {
                Ok(stream) => {
                    thread::spawn(move || {
                        handle_websocket_connection(stream, registry);
                    });
                }
                Err(error) => {
                    eprintln!("Websocket connection failed: {error}");
                }
            }
        }
    });
}

fn handle_websocket_connection(stream: std::net::TcpStream, registry: Arc<CropCancellationRegistry>) {
    let mut socket = match accept(stream) {
        Ok(socket) => socket,
        Err(error) => {
            eprintln!("Websocket handshake failed: {error}");
            return;
        }
    };

    loop {
        match socket.read() {
            Ok(message) => {
                if !message.is_text() {
                    continue;
                }

                let text = match message.to_text() {
                    Ok(text) => text,
                    Err(error) => {
                        eprintln!("Invalid websocket message frame: {error}");
                        continue;
                    }
                };

                if let Err(error) = handle_websocket_message(&mut socket, text, &registry) {
                    eprintln!("Websocket message handling error: {error}");
                }
            }
            Err(error) => {
                if !matches!(error, tungstenite::Error::ConnectionClosed) {
                    eprintln!("Websocket read error: {error}");
                }
                break;
            }
        }
    }
}

fn parse_payload<T>(request: &RpcRequest) -> Result<T, String>
where
    T: DeserializeOwned,
{
    serde_json::from_value(request.payload.clone()).map_err(|error| error.to_string())
}

fn emit_error(
    socket: &mut tungstenite::WebSocket<std::net::TcpStream>,
    id: String,
    error: String,
) -> Result<(), String> {
    send_response(
        socket,
        RpcResponse {
            id,
            ok: false,
            result: None,
            error: Some(error),
        },
    )
}

fn emit_result<T>(
    socket: &mut tungstenite::WebSocket<std::net::TcpStream>,
    id: String,
    result: T,
) -> Result<(), String>
where
    T: Serialize,
{
    send_response(
        socket,
        RpcResponse {
            id,
            ok: true,
            result: Some(serde_json::to_value(result).map_err(|error| error.to_string())?),
            error: None,
        },
    )
}

fn send_raw_event(
    socket: &mut tungstenite::WebSocket<std::net::TcpStream>,
    event: &str,
    payload: Value,
) -> Result<(), String> {
    let message = RpcEvent {
        event: event.to_string(),
        payload,
    };
    let text = serde_json::to_string(&message).map_err(|error| error.to_string())?;
    socket
        .send(Message::Text(text.into()))
        .map_err(|error| error.to_string())
}

fn send_response(
    socket: &mut tungstenite::WebSocket<std::net::TcpStream>,
    response: RpcResponse,
) -> Result<(), String> {
    let text = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    socket
        .send(Message::Text(text.into()))
        .map_err(|error| error.to_string())
}

fn handle_websocket_message(
    socket: &mut tungstenite::WebSocket<std::net::TcpStream>,
    text: &str,
    registry: &Arc<CropCancellationRegistry>,
) -> Result<(), String> {
    let request: RpcRequest = serde_json::from_str(text).map_err(|error| error.to_string())?;

    match request.method.as_str() {
        "list_directory" => {
            let payload: ListDirectoryPayload = parse_payload(&request)?;
            let listed = host_fs::list_directory(payload.path)?;
            emit_result(socket, request.id, listed)?
        }
        "user_home_directory" => {
            let home = host_fs::user_home_directory()?;
            emit_result(socket, request.id, home)?
        }
        "read_text_file" => {
            let payload: ReadTextFilePayload = parse_payload(&request)?;
            let body: String = host_fs::read_text_file(payload.path)?;
            emit_result(socket, request.id, body)?
        }
        "roi_pos_exists" => {
            let payload: WorkspacePosPayload = parse_payload(&request)?;
            emit_result(socket, request.id, roi_pos_exists(payload.workspace_path, payload.pos))?
        }
        "scan_source" => {
            let payload: ScanSourcePayload = parse_payload(&request)?;
            emit_result(socket, request.id, scan_source(payload.source)?)?
        }
        "load_frame" => {
            let payload: LoadFramePayload = parse_payload(&request)?;
            emit_result(
                socket,
                request.id,
                load_frame(payload.source, payload.request, payload.contrast)?,
            )?
        }
        "scan_roi_workspace" => {
            let payload: WorkspacePayload = parse_payload(&request)?;
            emit_result(socket, request.id, scan_roi_workspace(payload.workspace_path)?)?
        }
        "list_saved_bbox_positions" => {
            let payload: WorkspacePayload = parse_payload(&request)?;
            emit_result(
                socket,
                request.id,
                list_saved_bbox_positions(payload.workspace_path)?,
            )?
        }
        "load_align_state" => {
            let payload: WorkspacePosPayload = parse_payload(&request)?;
            emit_result(
                socket,
                request.id,
                load_align_state(payload.workspace_path, payload.pos)?,
            )?
        }
        "auto_exclude_preview" => {
            let payload: AutoExcludePreviewPayload = parse_payload(&request)?;
            emit_result(socket, request.id, auto_exclude_preview(payload.request)?)?
        }
        "load_annotation_labels" => {
            let payload: LabelListPayload = parse_payload(&request)?;
            emit_result(socket, request.id, load_annotation_labels(payload.workspace_path)?)?
        }
        "save_annotation_labels" => {
            let payload: LabelSavePayload = parse_payload(&request)?;
            emit_result(
                socket,
                request.id,
                save_annotation_labels(payload.workspace_path, payload.labels)?,
            )?
        }
        "load_roi_frame" => {
            let payload: RoiFramePayload = parse_payload(&request)?;
            emit_result(
                socket,
                request.id,
                load_roi_frame(payload.workspace_path, payload.request, payload.contrast)?,
            )?
        }
        "load_roi_frame_annotation" => {
            let payload: RoiFrameAnnotationRequestPayload = parse_payload(&request)?;
            emit_result(
                socket,
                request.id,
                load_roi_frame_annotation(payload.workspace_path, payload.request)?,
            )?
        }
        "save_roi_frame_annotation" => {
            let payload: SaveRoiFramePayload = parse_payload(&request)?;
            emit_result(
                socket,
                request.id,
                save_roi_frame_annotation(
                    payload.workspace_path,
                    payload.request,
                    payload.annotation,
                )?,
            )?
        }
        "save_bbox" => {
            let payload: SaveBboxPayload = parse_payload(&request)?;
            emit_result(
                socket,
                request.id,
                save_bbox(
                    payload.workspace_path,
                    payload.pos,
                    payload.csv,
                    payload.align_state,
                ),
            )?;
        }
        "cancel_crop_roi" => {
            let payload: CancelCropPayload = parse_payload(&request)?;
            registry.cancel(&payload.request_id);
            emit_result::<serde_json::Value>(socket, request.id, Value::Null)?
        }
        "crop_roi" => {
            let payload: CropPayload = parse_payload(&request)?;
            let request_id_for_event = payload.request_id.clone();
            let result = execute_crop_roi(
                &registry,
                payload.workspace_path,
                payload.source,
                payload.pos,
                payload.format,
                payload.batch,
                payload.request_id,
                |progress, message| {
                    let event_payload = json!({
                        "request_id": request_id_for_event.clone(),
                        "progress": progress,
                        "message": message,
                    });
                    send_raw_event(socket, CROP_PROGRESS_EVENT, event_payload)
                },
            );
            emit_result(socket, request.id, result)?
        }
        _ => {
            emit_error(socket, request.id, format!("Unknown method: {}", request.method))?;
        }
    }

    Ok(())
}

fn execute_crop_roi(
    registry: &Arc<CropCancellationRegistry>,
    workspace_path: String,
    source: ViewerSource,
    pos: u32,
    format: CropOutputFormat,
    batch: Option<usize>,
    request_id: String,
    mut emit_progress: impl FnMut(f64, &str) -> Result<(), String>,
) -> CropRoiResponse {
    let mut last_emit_at = Instant::now()
        .checked_sub(Duration::from_secs(1))
        .unwrap_or_else(Instant::now);
    let mut last_progress = -1.0f64;
    let request_id_for_cancel = request_id.clone();

    let response = run_crop_roi(
        workspace_path,
        source,
        pos,
        format,
        batch,
        &mut |progress, message| {
            let should_emit = progress >= 1.0
                || progress <= 0.0
                || (progress - last_progress).abs() >= 0.01
                || last_emit_at.elapsed() >= Duration::from_millis(80);

            if !should_emit {
                return Ok(());
            }

            last_emit_at = Instant::now();
            last_progress = progress;
            emit_progress(progress, &message.to_string())
        },
        &|| registry.is_cancelled(&request_id_for_cancel),
    );

    registry.clear(&request_id_for_cancel);
    response
}

#[command]
fn roi_pos_exists(workspace_path: String, pos: u32) -> bool {
    Path::new(&workspace_path)
        .join("roi")
        .join(format!("Pos{pos}"))
        .is_dir()
}

#[command]
fn scan_source(source: ViewerSource) -> Result<WorkspaceScan, String> {
    run_scan_source(source)
}

#[command]
fn load_frame(
    source: ViewerSource,
    request: FrameRequest,
    contrast: Option<ContrastWindow>,
) -> Result<FramePayload, String> {
    load_frame_payload(source, request, contrast)
}

#[command]
fn scan_roi_workspace(workspace_path: String) -> Result<RoiWorkspaceScan, String> {
    run_scan_roi_workspace(workspace_path)
}

#[command]
fn list_saved_bbox_positions(workspace_path: String) -> Result<Vec<u32>, String> {
    run_list_saved_bbox_positions(workspace_path)
}

#[command]
fn load_align_state(workspace_path: String, pos: u32) -> Result<Option<SavedAlignState>, String> {
    run_load_align_state(workspace_path, pos)
}

#[command]
fn auto_exclude_preview(
    request: AutoExcludePreviewRequest,
) -> Result<AutoExcludePreviewResponse, String> {
    run_auto_exclude_preview(request)
}

#[command]
fn load_annotation_labels(workspace_path: String) -> Result<Vec<AnnotationLabel>, String> {
    run_load_annotation_labels(workspace_path)
}

#[command]
fn save_annotation_labels(
    workspace_path: String,
    labels: Vec<AnnotationLabel>,
) -> Result<Vec<AnnotationLabel>, String> {
    run_save_annotation_labels(workspace_path, labels)
}

#[command]
fn load_roi_frame(
    workspace_path: String,
    request: RoiFrameRequest,
    contrast: Option<ContrastWindow>,
) -> Result<FramePayload, String> {
    load_roi_frame_payload(workspace_path, request, contrast)
}

#[command]
fn load_roi_frame_annotation(
    workspace_path: String,
    request: RoiFrameRequest,
) -> Result<LoadedRoiFrameAnnotation, String> {
    run_load_roi_frame_annotation(workspace_path, request)
}

#[command]
fn save_roi_frame_annotation(
    workspace_path: String,
    request: RoiFrameRequest,
    annotation: BackendRoiFrameAnnotationPayload,
) -> Result<RoiFrameAnnotation, String> {
    run_save_roi_frame_annotation(workspace_path, request, annotation)
}

#[command]
fn save_bbox(
    workspace_path: String,
    pos: u32,
    csv: String,
    align_state: SavedAlignState,
) -> SaveBboxResponse {
    run_save_bbox(workspace_path, pos, csv, align_state)
}

#[command]
fn cancel_crop_roi(request_id: String, registry: State<'_, Arc<CropCancellationRegistry>>) {
    registry.cancel(&request_id);
}

#[command]
async fn crop_roi(
    window: WebviewWindow,
    registry: State<'_, Arc<CropCancellationRegistry>>,
    workspace_path: String,
    source: ViewerSource,
    pos: u32,
    format: CropOutputFormat,
    batch: Option<usize>,
    request_id: String,
) -> Result<CropRoiResponse, String> {
    let registry = registry.inner().clone();
    let request_id_for_emit = request_id.clone();
    let response = tauri::async_runtime::spawn_blocking(move || {
        execute_crop_roi(
            &registry,
            workspace_path,
            source,
            pos,
            format,
            batch,
            request_id,
            move |progress, message| {
                window
                    .emit(
                        "viewer://crop-progress",
                        CropRoiProgress {
                            request_id: request_id_for_emit.clone(),
                            progress,
                            message: message.to_string(),
                        },
                    )
                    .map_err(|err| err.to_string())
            },
        )
    })
    .await
    .unwrap_or_else(|error| CropRoiResponse {
        ok: false,
        status: CropRoiStatus::Error,
        cancelled: None,
        error: Some(format!("Failed to join ROI crop task: {error}")),
        output_path: None,
    });

    Ok(response)
}

fn main() {
    apply_linux_webkit_workarounds();

    let cli = Cli::parse();

    let registry = Arc::new(CropCancellationRegistry::default());

    match &cli.command {
        Some(CliCommand::Server(server)) => {
            let port = server.port.unwrap_or(3412);
            let addr = server_listen_addr(port, server.lan);
            spawn_websocket_server(Arc::clone(&registry), addr.clone());
            eprintln!("LISCA viewer (headless). Ctrl+C to stop. Listening on {addr}");
            thread::park();
            return;
        }
        None => {}
    }

    spawn_websocket_server(Arc::clone(&registry), websocket_listen_address());

    tauri::Builder::default()
        .manage(Arc::clone(&registry))
        .invoke_handler(tauri::generate_handler![
            roi_pos_exists,
            scan_source,
            load_frame,
            scan_roi_workspace,
            list_saved_bbox_positions,
            load_align_state,
            auto_exclude_preview,
            load_annotation_labels,
            save_annotation_labels,
            load_roi_frame,
            load_roi_frame_annotation,
            save_roi_frame_annotation,
            save_bbox,
            cancel_crop_roi,
            crop_roi
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

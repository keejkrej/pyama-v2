#![cfg_attr(target_os = "windows", windows_subsystem = "console")]

mod cli_launch;

#[cfg(target_os = "linux")]
use std::path::Path;
use std::{env, net::TcpListener, thread};

use clap::Parser;
use pyama::host_fs;
use pyama::backend::{
    auto_exclude_preview as run_auto_exclude_preview,
    list_saved_bbox_positions as run_list_saved_bbox_positions,
    load_align_state as run_load_align_state, load_frame_payload, save_bbox as run_save_bbox,
    scan_source as run_scan_source, AutoExcludePreviewRequest, AutoExcludePreviewResponse,
    ContrastWindow, FramePayload, FrameRequest, SaveBboxResponse, AlignState, Source,
    WorkspaceScan,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use tauri::command;
use cli_launch::{server_listen_addr, Cli, CliCommand};
use tungstenite::{accept, Message};

const WEBSOCKET_DEFAULT_ADDR: &str = "127.0.0.1:3412";

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanSourcePayload {
    source: Source,
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
    source: Source,
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
struct SaveBboxPayload {
    workspace_path: String,
    pos: u32,
    csv: String,
    align_state: AlignState,
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

fn websocket_listen_address() -> String {
    let configured = env::var("PYAMA_WEBSOCKET_URL")
        .or_else(|_| env::var("PYAMA_WEBSOCKET_ADDR"))
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

fn spawn_websocket_server(listen_addr: String) {
    let listener = match TcpListener::bind(&listen_addr) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Failed to bind websocket listener on {listen_addr}: {error}");
            return;
        }
    };

    thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    thread::spawn(move || {
                        handle_websocket_connection(stream);
                    });
                }
                Err(error) => {
                    eprintln!("Websocket connection failed: {error}");
                }
            }
        }
    });
}

fn handle_websocket_connection(stream: std::net::TcpStream) {
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

                if let Err(error) = handle_websocket_message(&mut socket, text) {
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
        _ => {
            emit_error(socket, request.id, format!("Unknown method: {}", request.method))?;
        }
    }

    Ok(())
}

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

fn main() {
    apply_linux_webkit_workarounds();

    let cli = Cli::parse();

    match &cli.command {
        Some(CliCommand::Server(server)) => {
            let port = server.port.unwrap_or(3412);
            let addr = server_listen_addr(port, server.lan);
            spawn_websocket_server(addr.clone());
            eprintln!("Pyama (headless). Ctrl+C to stop. Listening on {addr}");
            thread::park();
            return;
        }
        None => {}
    }

    spawn_websocket_server(websocket_listen_address());

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_source,
            load_frame,
            list_saved_bbox_positions,
            load_align_state,
            auto_exclude_preview,
            save_bbox
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

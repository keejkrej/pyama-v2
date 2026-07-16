//! Host filesystem helpers for WebSocket-backed directory browsing (no native pickers).

use serde::Serialize;
use std::fs;
#[cfg(windows)]
use std::env;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFsEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostListDirectoryResult {
    /// `None` at the virtual roots view (drive letters / top-level).
    pub path: Option<String>,
    pub parent: Option<String>,
    pub entries: Vec<HostFsEntry>,
}

#[cfg(windows)]
fn list_roots() -> Result<HostListDirectoryResult, String> {
    let mut entries = Vec::new();
    for letter in b'A'..=b'Z' {
        let drive = char::from(letter);
        let path = format!("{drive}:\\");
        if Path::new(&path).exists() {
            entries.push(HostFsEntry {
                name: format!("{drive}:"),
                path,
                is_directory: true,
            });
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(HostListDirectoryResult {
        path: None,
        parent: None,
        entries,
    })
}

#[cfg(not(windows))]
fn list_roots() -> Result<HostListDirectoryResult, String> {
    Ok(HostListDirectoryResult {
        path: None,
        parent: None,
        entries: vec![HostFsEntry {
            name: "/".to_string(),
            path: "/".to_string(),
            is_directory: true,
        }],
    })
}

fn list_one_directory(path: &Path) -> Result<HostListDirectoryResult, String> {
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", path.to_string_lossy()));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let full_path = entry.path();
        entries.push(HostFsEntry {
            name,
            path: full_path.to_string_lossy().to_string(),
            is_directory: file_type.is_dir(),
        });
    }

    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    let current = path.to_string_lossy().to_string();
    let parent = path.parent().and_then(|p| {
        let raw = p.to_string_lossy();
        if raw.is_empty() {
            None
        } else {
            Some(raw.into_owned())
        }
    });

    Ok(HostListDirectoryResult {
        path: Some(current),
        parent,
        entries,
    })
}

/// When `path` is `None` or blank, lists platform roots. Otherwise lists that directory.
pub fn list_directory(path: Option<String>) -> Result<HostListDirectoryResult, String> {
    match &path {
        None => list_roots(),
        Some(p) if p.trim().is_empty() => list_roots(),
        Some(p) => list_one_directory(Path::new(p.trim())),
    }
}

/// Home directory of the user account running this process (the WebSocket / host server),
/// not the webview or any remote client.
pub fn user_home_directory() -> Result<String, String> {
    #[cfg(windows)]
    {
        if let Ok(p) = env::var("USERPROFILE") {
            let trimmed = p.trim();
            if !trimmed.is_empty() {
                let path = Path::new(trimmed);
                if path.is_dir() {
                    return Ok(path.to_string_lossy().to_string());
                }
            }
        }
        let drive = env::var("HOMEDRIVE").unwrap_or_default();
        let home_path = env::var("HOMEPATH").unwrap_or_default();
        let combined = format!("{drive}{home_path}");
        let trimmed = combined.trim();
        if trimmed.is_empty() {
            return Err(
                "Could not resolve user home directory (USERPROFILE / HOMEDRIVE+HOMEPATH)"
                    .to_string(),
            );
        }
        let path = Path::new(trimmed);
        if !path.is_dir() {
            return Err(format!("Home path is not a directory: {trimmed}"));
        }
        Ok(path.to_string_lossy().to_string())
    }
    #[cfg(not(windows))]
    {
        let p =
            std::env::var("HOME").map_err(|_| "HOME environment variable is not set".to_string())?;
        let trimmed = p.trim();
        if trimmed.is_empty() {
            return Err("HOME is set but empty".to_string());
        }
        let path = Path::new(trimmed);
        if !path.is_dir() {
            return Err(format!("HOME is not a directory: {trimmed}"));
        }
        Ok(path.to_string_lossy().to_string())
    }
}

pub fn read_text_file(path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }
    let p = Path::new(trimmed);
    if !p.is_file() {
        return Err(format!("Not a file: {}", trimmed));
    }
    fs::read_to_string(p).map_err(|e| e.to_string())
}

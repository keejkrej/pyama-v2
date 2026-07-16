use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use crate::viewer::domain::{
    parse_bbox_csv_name, workspace_align_json_path, workspace_bbox_csv_path, SaveBboxResponse,
    AlignState,
};

pub fn list_saved_bbox_positions(workspace_path: String) -> Result<Vec<u32>, String> {
    let root = Path::new(&workspace_path).join("bbox");
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let mut positions = BTreeSet::new();
    for entry in fs::read_dir(root).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(pos) = parse_bbox_csv_name(&name) else {
            continue;
        };
        positions.insert(pos);
    }

    Ok(positions.into_iter().collect())
}

pub fn load_align_state(
    workspace_path: String,
    pos: u32,
) -> Result<Option<AlignState>, String> {
    let path = workspace_align_json_path(&workspace_path, pos);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Failed to read align state at {}: {error}",
                path.display()
            ))
        }
    };

    serde_json::from_slice::<AlignState>(&bytes)
        .map(Some)
        .map_err(|err| format!("{}: {err}", path.display()))
}

pub fn save_bbox(
    workspace_path: String,
    pos: u32,
    csv: String,
    align_state: AlignState,
) -> SaveBboxResponse {
    let bbox_target = workspace_bbox_csv_path(&workspace_path, pos);
    let Some(bbox_parent) = bbox_target.parent() else {
        return SaveBboxResponse {
            ok: false,
            error: Some("Unable to resolve bbox output directory".to_string()),
        };
    };
    if let Err(error) = fs::create_dir_all(bbox_parent) {
        return SaveBboxResponse {
            ok: false,
            error: Some(error.to_string()),
        };
    }

    let align_target = workspace_align_json_path(&workspace_path, pos);
    let Some(align_parent) = align_target.parent() else {
        return SaveBboxResponse {
            ok: false,
            error: Some("Unable to resolve align output directory".to_string()),
        };
    };
    if let Err(error) = fs::create_dir_all(align_parent) {
        return SaveBboxResponse {
            ok: false,
            error: Some(error.to_string()),
        };
    }

    let normalized = if csv.ends_with('\n') {
        csv
    } else {
        format!("{csv}\n")
    };
    let align_json = match serde_json::to_vec_pretty(&align_state) {
        Ok(bytes) => bytes,
        Err(error) => {
            return SaveBboxResponse {
                ok: false,
                error: Some(error.to_string()),
            }
        }
    };

    match fs::write(&bbox_target, normalized).and_then(|_| fs::write(&align_target, align_json)) {
        Ok(_) => SaveBboxResponse {
            ok: true,
            error: None,
        },
        Err(error) => SaveBboxResponse {
            ok: false,
            error: Some(error.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::viewer::domain::{GridCellCoord, GridShape, GridState};

    fn unique_test_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("pyama-{name}-{suffix}"));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    #[test]
    fn list_saved_bbox_positions_returns_sorted_positions() {
        let root = unique_test_dir("saved-bboxes");
        let bbox_dir = root.join("bbox");
        fs::create_dir_all(&bbox_dir).expect("create bbox dir");
        fs::write(bbox_dir.join("Pos10.csv"), "roi,x,y,w,h\n0,0,0,1,1\n").expect("write bbox 10");
        fs::write(bbox_dir.join("pos2.csv"), "roi,x,y,w,h\n0,0,0,1,1\n").expect("write bbox 2");
        fs::write(bbox_dir.join("notes.txt"), "ignore").expect("write notes");
        fs::write(bbox_dir.join("PosX.csv"), "ignore").expect("write malformed bbox");

        let positions = list_saved_bbox_positions(root.to_string_lossy().to_string())
            .expect("scan saved bboxes");
        assert_eq!(positions, vec![2, 10]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_bbox_writes_csv_and_align_state() {
        let root = unique_test_dir("save-bbox");
        let align_state = AlignState {
            grid: GridState {
                enabled: true,
                shape: GridShape::Hex,
                tx: 1.5,
                ty: -2.0,
                rotation: 0.25,
                spacing_a: 150.0,
                spacing_b: 175.0,
                cell_width: 80.0,
                cell_height: 90.0,
                opacity: 0.4,
            },
            excluded_cells: vec![GridCellCoord { i: 3, j: 4 }],
        };

        let response = save_bbox(
            root.to_string_lossy().to_string(),
            7,
            "roi,x,y,w,h\n0,0,0,1,1".to_string(),
            align_state.clone(),
        );

        assert!(response.ok);
        assert_eq!(response.error, None);
        assert_eq!(
            fs::read_to_string(root.join("bbox").join("Pos7.csv")).expect("read bbox csv"),
            "roi,x,y,w,h\n0,0,0,1,1\n"
        );

        let saved_align = load_align_state(root.to_string_lossy().to_string(), 7)
            .expect("load align state")
            .expect("saved align state");
        assert_eq!(saved_align.grid.tx, align_state.grid.tx);
        assert_eq!(saved_align.grid.ty, align_state.grid.ty);
        assert_eq!(saved_align.excluded_cells.len(), 1);
        assert_eq!(saved_align.excluded_cells[0].i, 3);
        assert_eq!(saved_align.excluded_cells[0].j, 4);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_align_state_returns_none_when_missing() {
        let root = unique_test_dir("missing-align");

        let loaded =
            load_align_state(root.to_string_lossy().to_string(), 4).expect("load align state");
        assert!(loaded.is_none());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_align_state_returns_error_for_invalid_json() {
        let root = unique_test_dir("invalid-align");
        let align_dir = root.join("align");
        fs::create_dir_all(&align_dir).expect("create align dir");
        fs::write(align_dir.join("Pos2.json"), "{not-json").expect("write invalid json");

        let error = load_align_state(root.to_string_lossy().to_string(), 2)
            .expect_err("invalid align json");
        assert!(error.contains("Pos2.json"));

        let _ = fs::remove_dir_all(root);
    }
}

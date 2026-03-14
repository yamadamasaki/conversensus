use crate::models::ConversensusFile;
use crate::storage::{read_file, write_file, StorageError};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(serde::Serialize)]
pub struct OpenFileResult {
    pub file: ConversensusFile,
    pub path: String,
}

/// Open a .conversensus.json file via native dialog.
/// Returns the parsed file + path on success, or an error string.
#[tauri::command]
pub async fn open_file(app: AppHandle) -> Result<OpenFileResult, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("conversensus", &["conversensus.json"])
        .blocking_pick_file();

    let Some(path) = path else {
        return Err("cancelled".to_string());
    };

    let path_buf = PathBuf::from(path.to_string());
    let file = read_file(&path_buf).map_err(|e| e.to_string())?;
    Ok(OpenFileResult {
        file,
        path: path_buf.to_string_lossy().to_string(),
    })
}

/// Save a ConversensusFile, prompting for path if none given.
/// Returns the path it was saved to.
#[tauri::command]
pub async fn save_file(
    app: AppHandle,
    file: ConversensusFile,
    current_path: Option<String>,
) -> Result<String, String> {
    let path = if let Some(p) = current_path {
        PathBuf::from(p)
    } else {
        let chosen = app
            .dialog()
            .file()
            .add_filter("conversensus", &["conversensus.json"])
            .set_file_name("untitled.conversensus.json")
            .blocking_save_file();

        let Some(chosen) = chosen else {
            return Err("cancelled".to_string());
        };
        PathBuf::from(chosen.to_string())
    };

    write_file(&path, &file).map_err(|e: StorageError| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Create a new empty file (no dialog; just resets state in frontend).
#[tauri::command]
pub fn new_file() -> ConversensusFile {
    ConversensusFile::new_empty("Untitled")
}

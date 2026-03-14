use crate::models::{ConversensusFile, SUPPORTED_VERSION};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Unsupported file version '{found}'. This app supports version '{expected}'.")]
    UnsupportedVersion { found: String, expected: String },

    #[error("This version of conversensus supports single-sheet files only (found {found} sheets).")]
    MultipleSheets { found: usize },

    #[error("File has no sheets. Expected exactly one sheet.")]
    NoSheets,
}

/// Read and validate a .conversensus.json file from disk
pub fn read_file(path: &Path) -> Result<ConversensusFile, StorageError> {
    let content = std::fs::read_to_string(path)?;
    let file: ConversensusFile = serde_json::from_str(&content)?;

    // Version check
    if file.version != SUPPORTED_VERSION {
        return Err(StorageError::UnsupportedVersion {
            found: file.version.clone(),
            expected: SUPPORTED_VERSION.to_string(),
        });
    }

    // Step 0: enforce exactly one sheet
    match file.sheets.len() {
        0 => return Err(StorageError::NoSheets),
        1 => {}
        n => return Err(StorageError::MultipleSheets { found: n }),
    }

    Ok(file)
}

/// Write a ConversensusFile to disk as pretty-printed JSON
pub fn write_file(path: &Path, file: &ConversensusFile) -> Result<(), StorageError> {
    let json = serde_json::to_string_pretty(file)?;
    std::fs::write(path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use crate::models::Sheet;

    fn make_test_file() -> ConversensusFile {
        ConversensusFile::new_empty("Test")
    }

    #[test]
    fn test_write_and_read_round_trip() {
        let file = make_test_file();
        let tmp = NamedTempFile::new().unwrap();
        write_file(tmp.path(), &file).unwrap();
        let restored = read_file(tmp.path()).unwrap();
        assert_eq!(file, restored);
    }

    #[test]
    fn test_version_check_rejects_unknown_version() {
        let mut file = make_test_file();
        file.version = "99.0.0".to_string();
        let tmp = NamedTempFile::new().unwrap();
        let json = serde_json::to_string(&file).unwrap();
        std::fs::write(tmp.path(), json).unwrap();
        let err = read_file(tmp.path()).unwrap_err();
        assert!(matches!(err, StorageError::UnsupportedVersion { .. }));
    }

    #[test]
    fn test_multiple_sheets_rejected() {
        let mut file = make_test_file();
        file.sheets.push(Sheet {
            name: "Sheet 2".to_string(),
            description: String::new(),
            nodes: vec![],
            edges: vec![],
        });
        let tmp = NamedTempFile::new().unwrap();
        let json = serde_json::to_string(&file).unwrap();
        std::fs::write(tmp.path(), json).unwrap();
        let err = read_file(tmp.path()).unwrap_err();
        assert!(matches!(err, StorageError::MultipleSheets { found: 2 }));
    }

    #[test]
    fn test_empty_sheets_rejected() {
        let mut file = make_test_file();
        file.sheets.clear();
        let tmp = NamedTempFile::new().unwrap();
        let json = serde_json::to_string(&file).unwrap();
        std::fs::write(tmp.path(), json).unwrap();
        let err = read_file(tmp.path()).unwrap_err();
        assert!(matches!(err, StorageError::NoSheets));
    }

    #[test]
    fn test_malformed_json_rejected() {
        let tmp = NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), "not valid json {{{{").unwrap();
        let err = read_file(tmp.path()).unwrap_err();
        assert!(matches!(err, StorageError::Json(_)));
    }
}

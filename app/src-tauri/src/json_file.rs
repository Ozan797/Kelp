use std::io::Write;
use std::path::Path;

use serde::Serialize;

use crate::error::AppError;

pub fn write<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), AppError> {
    let json = serde_json::to_vec_pretty(value).map_err(|error| AppError::Io(error.to_string()))?;
    write_bytes(path, &json)
}

pub fn write_compact<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), AppError> {
    let json = serde_json::to_vec(value).map_err(|error| AppError::Io(error.to_string()))?;
    write_bytes(path, &json)
}

fn write_bytes(path: &Path, json: &[u8]) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    let mut file = std::fs::File::create(&temporary)?;
    file.write_all(json)?;
    file.sync_all()?;
    std::fs::rename(&temporary, path)?;
    Ok(())
}

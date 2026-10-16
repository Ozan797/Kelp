use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

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
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(format!(
        ".{}.{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = std::fs::File::create(&temporary)?;
    file.write_all(json)?;
    file.sync_all()?;
    std::fs::rename(&temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_racing_each_other_never_leave_a_broken_file() {
        let dir = std::env::temp_dir().join(format!("kelp-json-{}", uuid::Uuid::new_v4()));
        let path = dir.join("settings.json");
        let writers: Vec<_> = (0..8)
            .map(|n| {
                let path = path.clone();
                std::thread::spawn(move || {
                    (0..40)
                        .filter(|round| {
                            let value = "x".repeat((n * 7 + round) % 50);
                            write(&path, &serde_json::json!({ "theme": value })).is_err()
                        })
                        .count()
                })
            })
            .collect();
        let failed: usize = writers.into_iter().map(|w| w.join().unwrap()).sum();
        assert_eq!(failed, 0);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(
            serde_json::from_str::<serde_json::Value>(&text).is_ok(),
            "{text}"
        );
        let leftovers = std::fs::read_dir(&dir).unwrap().count();
        assert_eq!(leftovers, 1);
    }
}

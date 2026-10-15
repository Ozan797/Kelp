use std::path::{Path, PathBuf};

use super::model::{Status, Transfer};
use crate::error::AppError;

pub struct TransferStore {
    path: PathBuf,
}

impl TransferStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("transfers.json"),
        }
    }

    pub fn load(&self) -> Vec<Transfer> {
        let Ok(text) = std::fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        serde_json::from_str(&text).unwrap_or_else(|_| {
            let mut damaged = self.path.as_os_str().to_owned();
            damaged.push(".damaged");
            std::fs::rename(&self.path, damaged).ok();
            Vec::new()
        })
    }

    pub fn save(&self, transfers: &[Transfer]) -> Result<(), AppError> {
        let unfinished: Vec<&Transfer> = transfers
            .iter()
            .filter(|transfer| !matches!(transfer.status, Status::Finished | Status::Cancelled))
            .collect();
        crate::json_file::write_compact(&self.path, &unfinished)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transfers::model::tests::{item, transfer};
    use crate::transfers::model::{CompletedPart, Resume};
    use uuid::Uuid;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("kelp-store-{}", Uuid::new_v4()))
    }

    #[test]
    fn a_paused_upload_keeps_its_resume_data() {
        let store = TransferStore::new(&temp_dir());
        let mut paused = transfer(vec![item("a", 20)]);
        paused.status = Status::Paused;
        paused.items[0].resume = Some(Resume::Upload {
            upload_id: "up-1".into(),
            part_size: 8,
            parts: vec![CompletedPart {
                number: 1,
                etag: "\"e1\"".into(),
            }],
            local_size: 20,
            local_modified_ms: 7,
        });
        store.save(std::slice::from_ref(&paused)).unwrap();
        assert_eq!(store.load(), vec![paused]);
    }

    #[test]
    fn finished_and_cancelled_transfers_are_not_saved() {
        let store = TransferStore::new(&temp_dir());
        let mut finished = transfer(vec![item("a", 1)]);
        finished.status = Status::Finished;
        let mut cancelled = transfer(vec![item("b", 1)]);
        cancelled.status = Status::Cancelled;
        let failed = Transfer {
            status: Status::Failed,
            ..transfer(vec![item("c", 1)])
        };
        store.save(&[finished, cancelled, failed.clone()]).unwrap();
        assert_eq!(store.load(), vec![failed]);
    }

    #[test]
    fn a_missing_file_means_no_transfers() {
        assert!(TransferStore::new(&temp_dir()).load().is_empty());
    }

    #[test]
    fn a_damaged_file_is_moved_aside_and_kelp_starts_empty() {
        let dir = temp_dir();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("transfers.json"), "{ not json").unwrap();
        let store = TransferStore::new(&dir);
        assert!(store.load().is_empty());
        assert!(!dir.join("transfers.json").exists());
        assert_eq!(
            std::fs::read_to_string(dir.join("transfers.json.damaged")).unwrap(),
            "{ not json"
        );
    }
}

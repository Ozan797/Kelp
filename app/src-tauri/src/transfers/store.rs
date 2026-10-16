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
    use crate::transfers::model::{CompletedPart, Resume, Source};
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
    fn a_queue_saved_before_copies_existed_still_loads() {
        let dir = temp_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let saved = r#"[{"id":"7b1c2d3e-0000-4000-8000-000000000001","connectionId":"7b1c2d3e-0000-4000-8000-000000000002","direction":"upload","kind":"file","name":"a.txt","bucket":"media","localRoot":"/tmp/a.txt","remoteRoot":"2026/","status":"paused","error":null,"items":[{"local":"/tmp/a.txt","key":"2026/a.txt","size":5,"state":"pending","resume":null}]}]"#;
        std::fs::write(dir.join("transfers.json"), saved).unwrap();
        let loaded = TransferStore::new(&dir).load();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].source, None);
        assert_eq!(loaded[0].items[0].source_key, None);
    }

    #[test]
    fn a_copy_keeps_where_it_comes_from() {
        let store = TransferStore::new(&temp_dir());
        let mut copy = transfer(vec![item("cdn/a.jpg", 9)]);
        copy.direction = crate::transfers::model::Direction::Copy;
        copy.status = Status::Paused;
        copy.source = Some(Source {
            connection_id: Uuid::new_v4(),
            bucket: "media".into(),
            move_after: true,
        });
        copy.items[0].source_key = Some("vimeo/a.jpg".into());
        store.save(std::slice::from_ref(&copy)).unwrap();
        assert_eq!(store.load(), vec![copy]);
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

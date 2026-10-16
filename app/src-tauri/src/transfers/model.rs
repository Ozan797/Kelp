use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::providers::CompletedPart;

use super::plan::PART_SIZE;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Upload,
    Download,
    Copy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    File,
    Folder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Waiting,
    Running,
    Retrying { at_ms: u64 },
    Paused,
    Failed,
    Finished,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ItemState {
    Pending,
    Done,
    Failed { message: String },
    Refused { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Resume {
    #[serde(rename_all = "camelCase")]
    Upload {
        upload_id: String,
        part_size: u64,
        parts: Vec<CompletedPart>,
        local_size: u64,
        local_modified_ms: u64,
    },
    #[serde(rename_all = "camelCase")]
    Download {
        etag: String,
        part_path: PathBuf,
        done_ranges: Vec<u32>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub connection_id: Uuid,
    pub bucket: String,
    pub move_after: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub local: PathBuf,
    pub key: String,
    pub size: u64,
    pub state: ItemState,
    pub resume: Option<Resume>,
    #[serde(default)]
    pub source_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub direction: Direction,
    pub kind: Kind,
    pub name: String,
    pub bucket: String,
    pub local_root: PathBuf,
    pub remote_root: String,
    pub status: Status,
    pub error: Option<String>,
    pub items: Vec<Item>,
    #[serde(default)]
    pub source: Option<Source>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferView {
    pub id: Uuid,
    pub direction: Direction,
    pub kind: Kind,
    pub name: String,
    pub destination: String,
    pub status: &'static str,
    pub retry_at: Option<u64>,
    pub total: u64,
    pub done: u64,
    pub files_total: u64,
    pub files_done: u64,
    pub files_failed: u64,
    pub error: Option<String>,
    pub path: Option<String>,
    pub moving: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub id: Uuid,
    pub done: u64,
    pub total: u64,
    pub files_done: u64,
}

impl ItemState {
    pub fn is_failed(&self) -> bool {
        matches!(self, Self::Failed { .. } | Self::Refused { .. })
    }
}

fn piece(size: u64, piece_size: u64, index: u64) -> u64 {
    let start = index.saturating_mul(piece_size);
    piece_size.min(size.saturating_sub(start))
}

impl Item {
    pub fn pending(local: PathBuf, key: String, size: u64) -> Self {
        Self {
            local,
            key,
            size,
            state: ItemState::Pending,
            resume: None,
            source_key: None,
        }
    }

    pub fn done_bytes(&self) -> u64 {
        if self.state == ItemState::Done {
            return self.size;
        }
        match &self.resume {
            Some(Resume::Upload {
                part_size, parts, ..
            }) => parts
                .iter()
                .map(|part| {
                    piece(
                        self.size,
                        *part_size,
                        u64::from(part.number).saturating_sub(1),
                    )
                })
                .sum(),
            Some(Resume::Download { done_ranges, .. }) => done_ranges
                .iter()
                .map(|index| piece(self.size, PART_SIZE, u64::from(*index)))
                .sum(),
            None => 0,
        }
    }
}

impl Status {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Waiting => "waiting",
            Self::Running => "running",
            Self::Retrying { .. } => "retrying",
            Self::Paused => "paused",
            Self::Failed => "failed",
            Self::Finished => "finished",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(self, Self::Running | Self::Retrying { .. })
    }
}

impl Transfer {
    pub fn view(&self, done: u64) -> TransferView {
        let count = |wanted: fn(&ItemState) -> bool| {
            self.items.iter().filter(|item| wanted(&item.state)).count() as u64
        };
        let retry_at = match self.status {
            Status::Retrying { at_ms } => Some(at_ms),
            _ => None,
        };
        let local = self.local_root.to_string_lossy().into_owned();
        let (destination, path) = match self.direction {
            Direction::Upload | Direction::Copy => {
                (format!("{}/{}", self.bucket, self.remote_root), None)
            }
            Direction::Download => {
                let finished = self.status == Status::Finished;
                (local.clone(), finished.then_some(local))
            }
        };
        TransferView {
            id: self.id,
            direction: self.direction,
            kind: self.kind,
            name: self.name.clone(),
            destination,
            status: self.status.name(),
            retry_at,
            total: self.items.iter().map(|item| item.size).sum(),
            done,
            files_total: self.items.len() as u64,
            files_done: count(|state| *state == ItemState::Done),
            files_failed: count(ItemState::is_failed),
            error: self.error.clone(),
            path,
            moving: self.source.as_ref().is_some_and(|source| source.move_after),
        }
    }

    pub fn done_bytes(&self) -> u64 {
        self.items.iter().map(Item::done_bytes).sum()
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub fn item(key: &str, size: u64) -> Item {
        Item {
            local: PathBuf::from(format!("/tmp/{key}")),
            key: key.to_string(),
            size,
            state: ItemState::Pending,
            resume: None,
            source_key: None,
        }
    }

    pub fn transfer(items: Vec<Item>) -> Transfer {
        Transfer {
            id: Uuid::new_v4(),
            connection_id: Uuid::new_v4(),
            direction: Direction::Upload,
            kind: if items.len() == 1 {
                Kind::File
            } else {
                Kind::Folder
            },
            name: "photos".into(),
            bucket: "media".into(),
            local_root: PathBuf::from("/tmp/photos"),
            remote_root: "2026/".into(),
            status: Status::Waiting,
            error: None,
            items,
            source: None,
        }
    }

    #[test]
    fn the_view_adds_up_sizes_and_counts_files() {
        let mut folder = transfer(vec![item("a", 10), item("b", 20), item("c", 30)]);
        folder.items[0].state = ItemState::Done;
        folder.items[1].state = ItemState::Failed {
            message: "Access denied.".into(),
        };
        folder.status = Status::Retrying { at_ms: 5 };
        let view = folder.view(15);
        assert_eq!(view.total, 60);
        assert_eq!(view.done, 15);
        assert_eq!(
            (view.files_total, view.files_done, view.files_failed),
            (3, 1, 1)
        );
        assert_eq!(view.status, "retrying");
        assert_eq!(view.retry_at, Some(5));
        assert_eq!(view.destination, "media/2026/");
        assert_eq!(folder.done_bytes(), 10);
    }

    #[test]
    fn refused_items_count_as_failed() {
        let mut folder = transfer(vec![item("a", 1), item("b", 1)]);
        folder.items[1].state = ItemState::Refused {
            message: "x".into(),
        };
        assert_eq!(folder.view(0).files_failed, 1);
    }

    #[test]
    fn saved_parts_and_ranges_count_as_done() {
        let mib = 1024 * 1024;
        let mut upload = transfer(vec![item("a", 20 * mib)]);
        upload.items[0].resume = Some(Resume::Upload {
            upload_id: "u".into(),
            part_size: 8 * mib,
            parts: vec![
                CompletedPart {
                    number: 1,
                    etag: "e".into(),
                },
                CompletedPart {
                    number: 3,
                    etag: "e".into(),
                },
            ],
            local_size: 20 * mib,
            local_modified_ms: 0,
        });
        assert_eq!(upload.done_bytes(), 12 * mib);
        let mut download = transfer(vec![item("b", 20 * mib)]);
        download.items[0].resume = Some(Resume::Download {
            etag: "e".into(),
            part_path: PathBuf::from("/tmp/b.part"),
            done_ranges: vec![0, 2],
        });
        assert_eq!(download.done_bytes(), 12 * mib);
    }

    #[test]
    fn a_move_says_so_in_its_view() {
        let mut copy = transfer(vec![item("cdn/a.jpg", 1)]);
        copy.direction = Direction::Copy;
        assert!(!copy.view(0).moving);
        copy.source = Some(Source {
            connection_id: Uuid::new_v4(),
            bucket: "media".into(),
            move_after: true,
        });
        assert!(copy.view(0).moving);
    }

    #[test]
    fn a_finished_download_points_at_the_saved_file() {
        let mut download = transfer(vec![item("a", 1)]);
        download.direction = Direction::Download;
        download.local_root = PathBuf::from("/Users/me/Downloads/a.txt");
        assert_eq!(download.view(0).path, None);
        download.status = Status::Finished;
        assert_eq!(
            download.view(1).path.as_deref(),
            Some("/Users/me/Downloads/a.txt")
        );
    }
}

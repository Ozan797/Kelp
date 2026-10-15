use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::providers::CompletedPart;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Upload,
    Download,
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
pub struct Item {
    pub local: PathBuf,
    pub key: String,
    pub size: u64,
    pub state: ItemState,
    pub resume: Option<Resume>,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub id: Uuid,
    pub done: u64,
    pub total: u64,
    pub files_done: u64,
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
            Direction::Upload => (format!("{}/{}", self.bucket, self.remote_root), None),
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
            files_failed: count(|state| matches!(state, ItemState::Failed { .. })),
            error: self.error.clone(),
            path,
        }
    }

    pub fn done_bytes(&self) -> u64 {
        self.items
            .iter()
            .filter(|item| item.state == ItemState::Done)
            .map(|item| item.size)
            .sum()
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

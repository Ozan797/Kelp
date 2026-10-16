use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::commands::browse::list_all;
use crate::error::AppError;
use crate::state::AppState;
use crate::transfers::manager::TransferManager;
use crate::transfers::model::{Direction, Item, ItemState, Kind, Status, Transfer, TransferView};
use crate::transfers::paths::{reserve_download, safe_file_name, unique_download_path};
use crate::transfers::plan::{download_target, folder_name};

type Transfers<'a> = State<'a, Arc<TransferManager>>;

pub async fn folder_download_transfer(
    state: &AppState,
    dir: &Path,
    id: Uuid,
    bucket: &str,
    prefix: &str,
) -> Result<Transfer, AppError> {
    let provider = state.provider(id).await?;
    let objects = list_all(provider.as_ref(), bucket, prefix).await?;
    let name = folder_name(prefix);
    let target = unique_download_path(dir, &name);
    std::fs::create_dir_all(&target)?;
    let mut taken = HashSet::new();
    let items = objects
        .into_iter()
        .map(|object| {
            let refused = |message: &str| Item {
                state: ItemState::Refused {
                    message: message.to_string(),
                },
                ..Item::pending(target.clone(), object.key.clone(), object.size)
            };
            match download_target(prefix, &object.key, &target) {
                None => refused(UNSAFE_NAME),
                Some(local) if !taken.insert(local.to_string_lossy().to_lowercase()) => {
                    refused(SAME_NAME)
                }
                Some(local) => Item::pending(local, object.key, object.size),
            }
        })
        .collect();
    Ok(Transfer {
        id: Uuid::new_v4(),
        connection_id: id,
        direction: Direction::Download,
        kind: Kind::Folder,
        name,
        bucket: bucket.to_string(),
        local_root: target,
        remote_root: prefix.to_string(),
        status: Status::Waiting,
        error: None,
        items,
        source: None,
    })
}

const UNSAFE_NAME: &str = "This name can't be saved on a Mac.";
const SAME_NAME: &str =
    "Another file in this folder has the same name with different capital letters.";

pub fn download_transfer(
    dir: &Path,
    id: Uuid,
    bucket: &str,
    key: &str,
    size: u64,
) -> Result<Transfer, AppError> {
    let name = safe_file_name(key);
    let (target, _) = reserve_download(dir, &name)?;
    Ok(Transfer {
        id: Uuid::new_v4(),
        connection_id: id,
        direction: Direction::Download,
        kind: Kind::File,
        name,
        bucket: bucket.to_string(),
        local_root: target.clone(),
        remote_root: key.to_string(),
        status: Status::Waiting,
        error: None,
        items: vec![Item::pending(target, key.to_string(), size)],
        source: None,
    })
}

#[tauri::command]
pub async fn list_transfers(transfers: Transfers<'_>) -> Result<Vec<TransferView>, AppError> {
    Ok(transfers.list().await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    transfers: Transfers<'_>,
    id: Uuid,
    bucket: String,
    key: String,
    size: u64,
) -> Result<Uuid, AppError> {
    state.profile(id).await?;
    let dir = app
        .path()
        .download_dir()
        .map_err(|error| AppError::Io(error.to_string()))?;
    let transfer = download_transfer(&dir, id, &bucket, &key, size)?;
    Ok(transfers.add(transfer).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_folder_download(
    app: AppHandle,
    state: State<'_, AppState>,
    transfers: Transfers<'_>,
    id: Uuid,
    bucket: String,
    prefix: String,
) -> Result<Uuid, AppError> {
    let dir = app
        .path()
        .download_dir()
        .map_err(|error| AppError::Io(error.to_string()))?;
    let transfer = folder_download_transfer(&state, &dir, id, &bucket, &prefix).await?;
    Ok(transfers.add(transfer).await)
}

#[tauri::command]
pub async fn pause_transfer(transfers: Transfers<'_>, transfer: Uuid) -> Result<(), AppError> {
    transfers.pause(transfer).await;
    Ok(())
}

#[tauri::command]
pub async fn resume_transfer(transfers: Transfers<'_>, transfer: Uuid) -> Result<(), AppError> {
    transfers.resume(transfer).await;
    Ok(())
}

#[tauri::command]
pub async fn retry_transfer(transfers: Transfers<'_>, transfer: Uuid) -> Result<(), AppError> {
    transfers.retry(transfer).await;
    Ok(())
}

#[tauri::command]
pub async fn cancel_transfer(transfers: Transfers<'_>, transfer: Uuid) -> Result<(), AppError> {
    transfers.cancel(transfer).await;
    Ok(())
}

#[tauri::command]
pub async fn pause_all(transfers: Transfers<'_>) -> Result<(), AppError> {
    transfers.pause_all().await;
    Ok(())
}

#[tauri::command]
pub async fn resume_all(transfers: Transfers<'_>) -> Result<(), AppError> {
    transfers.resume_all().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use uuid::Uuid;

    use super::*;
    use crate::testing::{FakeProvider, state_with};
    use crate::transfers::model::{Direction, Kind};

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kelp-commands-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn a_folder_download_makes_its_own_folder_and_refuses_unsafe_names() {
        let fake = FakeProvider::empty().with_objects(vec![
            ("2026/photos/a.jpg", b"aa".to_vec()),
            ("2026/photos/raw/b.dng", b"bbb".to_vec()),
            ("2026/photos/../evil", b"x".to_vec()),
        ]);
        let (state, id) = state_with(Arc::new(fake), None).await;
        let dir = temp_dir();
        std::fs::create_dir_all(dir.join("photos")).unwrap();
        let transfer = folder_download_transfer(&state, &dir, id, "media", "2026/photos/")
            .await
            .unwrap();
        assert_eq!(transfer.kind, Kind::Folder);
        assert_eq!(transfer.local_root, dir.join("photos (1)"));
        assert!(dir.join("photos (1)").is_dir());
        let states: Vec<(&str, bool)> = transfer
            .items
            .iter()
            .map(|item| (item.key.as_str(), item.state == ItemState::Pending))
            .collect();
        assert_eq!(
            states,
            vec![
                ("2026/photos/../evil", false),
                ("2026/photos/a.jpg", true),
                ("2026/photos/raw/b.dng", true),
            ]
        );
        assert_eq!(
            transfer.items[2].local,
            dir.join("photos (1)").join("raw").join("b.dng")
        );
    }

    #[tokio::test]
    async fn folder_items_are_refused_for_unsafe_names_and_names_that_differ_only_in_capitals() {
        let fake = FakeProvider::empty().with_objects(vec![
            ("2026/photos/A.jpg", b"aa".to_vec()),
            ("2026/photos/a.jpg", b"bb".to_vec()),
            ("2026/photos/../evil", b"x".to_vec()),
        ]);
        let (state, id) = state_with(Arc::new(fake), None).await;
        let transfer = folder_download_transfer(&state, &temp_dir(), id, "media", "2026/photos/")
            .await
            .unwrap();
        let refused: Vec<&str> = transfer
            .items
            .iter()
            .filter(|item| matches!(item.state, ItemState::Refused { .. }))
            .map(|item| item.key.as_str())
            .collect();
        assert_eq!(refused, vec!["2026/photos/../evil", "2026/photos/a.jpg"]);
    }

    #[tokio::test]
    async fn a_download_reserves_its_file_in_the_folder() {
        let dir = temp_dir();
        std::fs::write(dir.join("teaser.mp4"), b"old").unwrap();
        let connection = Uuid::new_v4();
        let transfer = download_transfer(&dir, connection, "media", "2026/teaser.mp4", 9).unwrap();
        assert_eq!(transfer.direction, Direction::Download);
        assert_eq!(transfer.local_root, dir.join("teaser (1).mp4"));
        assert_eq!(transfer.items[0].local, dir.join("teaser (1).mp4"));
        assert_eq!(transfer.items[0].key, "2026/teaser.mp4");
        assert_eq!(transfer.items[0].size, 9);
        assert!(dir.join("teaser (1).mp4.part").exists());
    }
}

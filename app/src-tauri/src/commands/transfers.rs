use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::error::AppError;
use crate::providers::MAX_OBJECT_SIZE;
use crate::state::AppState;
use crate::transfers::manager::TransferManager;
use crate::transfers::model::{Direction, Item, ItemState, Kind, Status, Transfer, TransferView};
use crate::transfers::paths::{reserve_download, safe_file_name};

type Transfers<'a> = State<'a, Arc<TransferManager>>;

fn pending_item(local: PathBuf, key: String, size: u64) -> Item {
    Item {
        local,
        key,
        size,
        state: ItemState::Pending,
        resume: None,
    }
}

pub async fn upload_transfer(
    state: &AppState,
    id: Uuid,
    bucket: &str,
    prefix: &str,
    path: &Path,
    replace: bool,
) -> Result<Transfer, AppError> {
    let provider = state.provider(id).await?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Io("That file has no name.".into()))?
        .to_string();
    let size = tokio::fs::metadata(path).await?.len();
    if size > MAX_OBJECT_SIZE {
        return Err(AppError::FileTooLarge);
    }
    let key = format!("{prefix}{name}");
    if !replace && provider.list_keys(bucket, &key, None).await?.keys.first() == Some(&key) {
        return Err(AppError::AlreadyExists(name));
    }
    Ok(Transfer {
        id: Uuid::new_v4(),
        connection_id: id,
        direction: Direction::Upload,
        kind: Kind::File,
        name,
        bucket: bucket.to_string(),
        local_root: path.to_path_buf(),
        remote_root: prefix.to_string(),
        status: Status::Waiting,
        error: None,
        items: vec![pending_item(path.to_path_buf(), key, size)],
    })
}

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
        items: vec![pending_item(target, key.to_string(), size)],
    })
}

#[tauri::command]
pub async fn list_transfers(transfers: Transfers<'_>) -> Result<Vec<TransferView>, AppError> {
    Ok(transfers.list().await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_upload(
    state: State<'_, AppState>,
    transfers: Transfers<'_>,
    id: Uuid,
    bucket: String,
    prefix: String,
    path: String,
    replace: bool,
) -> Result<Uuid, AppError> {
    let transfer = upload_transfer(&state, id, &bucket, &prefix, Path::new(&path), replace).await?;
    Ok(transfers.add(transfer).await)
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
    use crate::error::AppError;
    use crate::testing::{FakeProvider, state_with};
    use crate::transfers::model::{Direction, Kind, Status};

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kelp-commands-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn an_upload_becomes_a_waiting_transfer_with_one_item() {
        let (state, id) = state_with(Arc::new(FakeProvider::empty()), None).await;
        let file = temp_dir().join("teaser.mp4");
        std::fs::write(&file, b"12345").unwrap();
        let transfer = upload_transfer(&state, id, "media", "2026/", &file, false)
            .await
            .unwrap();
        assert_eq!(
            (transfer.direction, transfer.kind, transfer.status),
            (Direction::Upload, Kind::File, Status::Waiting)
        );
        assert_eq!(transfer.connection_id, id);
        assert_eq!(transfer.items.len(), 1);
        assert_eq!(transfer.items[0].key, "2026/teaser.mp4");
        assert_eq!(transfer.items[0].size, 5);
        assert_eq!(transfer.view(0).destination, "media/2026/");
    }

    #[tokio::test]
    async fn uploading_over_an_existing_key_asks_first() {
        let fake = FakeProvider::empty().with_keys(vec!["2026/teaser.mp4".into()]);
        let (state, id) = state_with(Arc::new(fake), None).await;
        let file = temp_dir().join("teaser.mp4");
        std::fs::write(&file, b"x").unwrap();
        let refused = upload_transfer(&state, id, "media", "2026/", &file, false).await;
        assert_eq!(refused, Err(AppError::AlreadyExists("teaser.mp4".into())));
        assert!(
            upload_transfer(&state, id, "media", "2026/", &file, true)
                .await
                .is_ok()
        );
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

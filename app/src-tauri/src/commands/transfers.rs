use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;

use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::commands::browse::list_all;
use crate::error::AppError;
use crate::providers::MAX_OBJECT_SIZE;
use crate::state::AppState;
use crate::transfers::manager::TransferManager;
use crate::transfers::model::{Direction, Item, ItemState, Kind, Status, Transfer, TransferView};
use crate::transfers::paths::{reserve_download, safe_file_name, unique_download_path};
use crate::transfers::plan::{download_target, folder_name, local_name, upload_items};

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPlan {
    pub files: u64,
    pub bytes: u64,
    pub existing: u64,
    pub examples: Vec<String>,
}

const EXAMPLES: usize = 3;

async fn existing_keys(
    state: &AppState,
    id: Uuid,
    bucket: &str,
    prefix: &str,
    root: &Path,
) -> Result<(Vec<Item>, HashSet<String>), AppError> {
    let items = upload_items(root, prefix)?;
    let provider = state.provider(id).await?;
    let destination = format!("{prefix}{}/", local_name(root)?);
    let present: HashSet<String> = list_all(provider.as_ref(), bucket, &destination)
        .await?
        .into_iter()
        .map(|object| object.key)
        .collect();
    Ok((items, present))
}

pub async fn plan_folder(
    state: &AppState,
    id: Uuid,
    bucket: &str,
    prefix: &str,
    root: &Path,
) -> Result<FolderPlan, AppError> {
    let (items, present) = existing_keys(state, id, bucket, prefix, root).await?;
    let clashes: Vec<String> = items
        .iter()
        .filter(|item| present.contains(&item.key))
        .map(|item| item.key.clone())
        .collect();
    Ok(FolderPlan {
        files: items.len() as u64,
        bytes: items.iter().map(|item| item.size).sum(),
        existing: clashes.len() as u64,
        examples: clashes.into_iter().take(EXAMPLES).collect(),
    })
}

pub async fn folder_upload_transfer(
    state: &AppState,
    id: Uuid,
    bucket: &str,
    prefix: &str,
    root: &Path,
    skip_existing: bool,
) -> Result<Transfer, AppError> {
    let (mut items, present) = existing_keys(state, id, bucket, prefix, root).await?;
    if skip_existing {
        items.retain(|item| !present.contains(&item.key));
    }
    if items.iter().any(|item| item.size > MAX_OBJECT_SIZE) {
        return Err(AppError::FileTooLarge);
    }
    Ok(Transfer {
        id: Uuid::new_v4(),
        connection_id: id,
        direction: Direction::Upload,
        kind: Kind::Folder,
        name: local_name(root)?,
        bucket: bucket.to_string(),
        local_root: root.to_path_buf(),
        remote_root: prefix.to_string(),
        status: Status::Waiting,
        error: None,
        items,
    })
}

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
    let items = objects
        .into_iter()
        .map(
            |object| match download_target(prefix, &object.key, &target) {
                Some(local) => pending_item(local, object.key, object.size),
                None => Item {
                    state: ItemState::Failed {
                        message: UNSAFE_NAME.to_string(),
                    },
                    ..pending_item(target.clone(), object.key, object.size)
                },
            },
        )
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
    })
}

const UNSAFE_NAME: &str = "This name can't be saved on a Mac.";

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
    let page = provider.list_keys(bucket, &key, None).await?;
    if !replace && page.objects.first().is_some_and(|object| object.key == key) {
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

#[tauri::command(rename_all = "camelCase")]
pub async fn plan_folder_upload(
    state: State<'_, AppState>,
    id: Uuid,
    bucket: String,
    prefix: String,
    path: String,
) -> Result<FolderPlan, AppError> {
    plan_folder(&state, id, &bucket, &prefix, Path::new(&path)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_folder_upload(
    state: State<'_, AppState>,
    transfers: Transfers<'_>,
    id: Uuid,
    bucket: String,
    prefix: String,
    path: String,
    skip_existing: bool,
) -> Result<Uuid, AppError> {
    let transfer = folder_upload_transfer(
        &state,
        id,
        &bucket,
        &prefix,
        Path::new(&path),
        skip_existing,
    )
    .await?;
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

    fn photos_folder() -> PathBuf {
        let root = temp_dir().join("photos");
        std::fs::create_dir_all(root.join("raw")).unwrap();
        std::fs::write(root.join("a.jpg"), b"aa").unwrap();
        std::fs::write(root.join("raw").join("b.dng"), b"bbb").unwrap();
        root
    }

    #[tokio::test]
    async fn a_folder_plan_counts_files_and_finds_the_ones_already_there() {
        let fake = FakeProvider::empty().with_keys(vec![
            "2026/photos/raw/b.dng".into(),
            "2026/photos/other.jpg".into(),
        ]);
        let (state, id) = state_with(Arc::new(fake), None).await;
        let plan = plan_folder(&state, id, "media", "2026/", &photos_folder())
            .await
            .unwrap();
        assert_eq!(
            plan,
            FolderPlan {
                files: 2,
                bytes: 5,
                existing: 1,
                examples: vec!["2026/photos/raw/b.dng".into()],
            }
        );
    }

    #[tokio::test]
    async fn a_folder_upload_can_skip_what_is_already_there() {
        let fake = FakeProvider::empty().with_keys(vec!["2026/photos/raw/b.dng".into()]);
        let (state, id) = state_with(Arc::new(fake), None).await;
        let root = photos_folder();
        let all = folder_upload_transfer(&state, id, "media", "2026/", &root, false)
            .await
            .unwrap();
        assert_eq!((all.kind, all.items.len()), (Kind::Folder, 2));
        assert_eq!(all.name, "photos");
        let skipped = folder_upload_transfer(&state, id, "media", "2026/", &root, true)
            .await
            .unwrap();
        let keys: Vec<&str> = skipped.items.iter().map(|item| item.key.as_str()).collect();
        assert_eq!(keys, vec!["2026/photos/a.jpg"]);
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

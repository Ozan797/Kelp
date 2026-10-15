use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::commands::browse::list_all;
use crate::error::AppError;
use crate::providers::{MAX_OBJECT_SIZE, StorageProvider};
use crate::state::AppState;
use crate::transfers::manager::TransferManager;
use crate::transfers::model::{Direction, Item, Kind, Status, Transfer};
use crate::transfers::plan::{local_name, upload_items, walk_folder};

const EXAMPLES: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropSummary {
    pub files: u64,
    pub folders: u64,
    pub bytes: u64,
    pub loose: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPlan {
    pub files: u64,
    pub bytes: u64,
    pub existing: u64,
    pub examples: Vec<String>,
}

struct Entry {
    root: PathBuf,
    kind: Kind,
    items: Vec<Item>,
}

fn unique(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .iter()
        .filter(|path| seen.insert((*path).clone()))
        .cloned()
        .collect()
}

pub fn summarize(paths: &[PathBuf]) -> DropSummary {
    let mut summary = DropSummary {
        files: 0,
        folders: 0,
        bytes: 0,
        loose: 0,
    };
    for path in unique(paths) {
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if metadata.is_dir() {
            summary.folders += 1;
            for (_, _, size) in walk_folder(&path).unwrap_or_default() {
                summary.files += 1;
                summary.bytes += size;
            }
        } else {
            summary.files += 1;
            summary.loose += 1;
            summary.bytes += metadata.len();
        }
    }
    summary
}

fn entries(prefix: &str, paths: &[PathBuf]) -> Result<Vec<Entry>, AppError> {
    unique(paths)
        .into_iter()
        .map(|root| {
            let name = local_name(&root)?;
            let metadata = std::fs::metadata(&root).map_err(|_| {
                AppError::Io(format!(
                    "\"{name}\" is no longer there. Drop it again from Finder."
                ))
            })?;
            let (kind, items) = if metadata.is_dir() {
                (Kind::Folder, upload_items(&root, prefix)?)
            } else {
                let item = Item::pending(root.clone(), format!("{prefix}{name}"), metadata.len());
                (Kind::File, vec![item])
            };
            Ok(Entry { root, kind, items })
        })
        .collect()
}

async fn present(
    provider: &dyn StorageProvider,
    bucket: &str,
    prefix: &str,
    entry: &Entry,
) -> Result<HashSet<String>, AppError> {
    let within = match entry.kind {
        Kind::Folder => format!("{prefix}{}/", local_name(&entry.root)?),
        Kind::File => entry.items[0].key.clone(),
    };
    let found = match entry.kind {
        Kind::Folder => list_all(provider, bucket, &within).await?,
        Kind::File => provider.list_keys(bucket, &within, None).await?.objects,
    };
    Ok(found.into_iter().map(|object| object.key).collect())
}

async fn checked(
    state: &AppState,
    id: Uuid,
    bucket: &str,
    prefix: &str,
    paths: &[PathBuf],
) -> Result<Vec<(Entry, HashSet<String>)>, AppError> {
    let provider = state.provider(id).await?;
    let (owned_prefix, owned_paths) = (prefix.to_string(), paths.to_vec());
    let walked = tokio::task::spawn_blocking(move || entries(&owned_prefix, &owned_paths))
        .await
        .map_err(|error| AppError::Io(error.to_string()))??;
    let mut checked = Vec::new();
    for entry in walked {
        let found = present(provider.as_ref(), bucket, prefix, &entry).await?;
        checked.push((entry, found));
    }
    Ok(checked)
}

pub async fn plan_paths(
    state: &AppState,
    id: Uuid,
    bucket: &str,
    prefix: &str,
    paths: &[PathBuf],
) -> Result<FolderPlan, AppError> {
    let checked = checked(state, id, bucket, prefix, paths).await?;
    let items: Vec<&Item> = checked.iter().flat_map(|(entry, _)| &entry.items).collect();
    let clashes: Vec<String> = checked
        .iter()
        .flat_map(|(entry, found)| {
            entry
                .items
                .iter()
                .filter(|item| found.contains(&item.key))
                .map(|item| item.key.clone())
        })
        .collect();
    Ok(FolderPlan {
        files: items.len() as u64,
        bytes: items.iter().map(|item| item.size).sum(),
        existing: clashes.len() as u64,
        examples: clashes.into_iter().take(EXAMPLES).collect(),
    })
}

pub async fn upload_transfers(
    state: &AppState,
    id: Uuid,
    bucket: &str,
    prefix: &str,
    paths: &[PathBuf],
    skip_existing: bool,
) -> Result<Vec<Transfer>, AppError> {
    let checked = checked(state, id, bucket, prefix, paths).await?;
    let too_large = checked
        .iter()
        .flat_map(|(entry, _)| &entry.items)
        .any(|item| item.size > MAX_OBJECT_SIZE);
    if too_large {
        return Err(AppError::FileTooLarge);
    }
    let mut transfers = Vec::new();
    for (entry, found) in checked {
        let items: Vec<Item> = entry
            .items
            .into_iter()
            .filter(|item| !skip_existing || !found.contains(&item.key))
            .collect();
        if items.is_empty() {
            continue;
        }
        transfers.push(Transfer {
            id: Uuid::new_v4(),
            connection_id: id,
            direction: Direction::Upload,
            kind: entry.kind,
            name: local_name(&entry.root)?,
            bucket: bucket.to_string(),
            local_root: entry.root,
            remote_root: prefix.to_string(),
            status: Status::Waiting,
            error: None,
            items,
        });
    }
    Ok(transfers)
}

fn as_paths(paths: Vec<String>) -> Vec<PathBuf> {
    paths.into_iter().map(PathBuf::from).collect()
}

#[tauri::command]
pub async fn inspect_drop(paths: Vec<String>) -> Result<DropSummary, AppError> {
    let paths = as_paths(paths);
    tokio::task::spawn_blocking(move || summarize(&paths))
        .await
        .map_err(|error| AppError::Io(error.to_string()))
}

#[tauri::command]
pub async fn plan_upload(
    state: State<'_, AppState>,
    id: Uuid,
    bucket: String,
    prefix: String,
    paths: Vec<String>,
) -> Result<FolderPlan, AppError> {
    plan_paths(&state, id, &bucket, &prefix, &as_paths(paths)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_uploads(
    state: State<'_, AppState>,
    transfers: State<'_, Arc<TransferManager>>,
    id: Uuid,
    bucket: String,
    prefix: String,
    paths: Vec<String>,
    skip_existing: bool,
) -> Result<Vec<Uuid>, AppError> {
    let planned = upload_transfers(
        &state,
        id,
        &bucket,
        &prefix,
        &as_paths(paths),
        skip_existing,
    )
    .await?;
    let mut ids = Vec::new();
    for transfer in planned {
        ids.push(transfers.add(transfer).await);
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use uuid::Uuid;

    use super::*;
    use crate::error::AppError;
    use crate::testing::{FakeProvider, state_with};
    use crate::transfers::model::Kind;

    fn drop_folder() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kelp-drop-{}", Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("photos").join("raw")).unwrap();
        std::fs::write(dir.join("a.txt"), b"aa").unwrap();
        std::fs::write(dir.join("b.txt"), b"bbb").unwrap();
        std::fs::write(dir.join("photos").join("a.jpg"), b"aa").unwrap();
        std::fs::write(dir.join("photos").join("raw").join("b.dng"), b"bbb").unwrap();
        dir
    }

    fn dropped(dir: &std::path::Path) -> Vec<PathBuf> {
        vec![dir.join("a.txt"), dir.join("b.txt"), dir.join("photos")]
    }

    #[test]
    fn a_drop_is_counted_and_missing_paths_are_skipped() {
        let dir = drop_folder();
        let mut paths = dropped(&dir);
        paths.push(dir.join("gone.txt"));
        assert_eq!(
            summarize(&paths),
            DropSummary {
                files: 4,
                folders: 1,
                bytes: 10,
                loose: 2,
            }
        );
    }

    #[tokio::test]
    async fn a_plan_finds_existing_files_and_keys_inside_dropped_folders() {
        let fake = FakeProvider::empty().with_keys(vec![
            "2026/a.txt".into(),
            "2026/photos/raw/b.dng".into(),
            "2026/a.txt.bak".into(),
        ]);
        let (state, id) = state_with(Arc::new(fake), None).await;
        let dir = drop_folder();
        let plan = plan_paths(&state, id, "media", "2026/", &dropped(&dir))
            .await
            .unwrap();
        assert_eq!(
            plan,
            FolderPlan {
                files: 4,
                bytes: 10,
                existing: 2,
                examples: vec!["2026/a.txt".into(), "2026/photos/raw/b.dng".into()],
            }
        );
    }

    #[tokio::test]
    async fn every_dropped_file_and_folder_becomes_its_own_transfer() {
        let fake = FakeProvider::empty()
            .with_keys(vec!["2026/a.txt".into(), "2026/photos/raw/b.dng".into()]);
        let (state, id) = state_with(Arc::new(fake), None).await;
        let dir = drop_folder();
        let all = upload_transfers(&state, id, "media", "2026/", &dropped(&dir), false)
            .await
            .unwrap();
        let shape: Vec<(Kind, usize)> = all.iter().map(|t| (t.kind, t.items.len())).collect();
        assert_eq!(
            shape,
            vec![(Kind::File, 1), (Kind::File, 1), (Kind::Folder, 2)]
        );
        assert_eq!(all[0].items[0].key, "2026/a.txt");
        assert_eq!(all[2].name, "photos");

        let skipped = upload_transfers(&state, id, "media", "2026/", &dropped(&dir), true)
            .await
            .unwrap();
        let keys: Vec<Vec<&str>> = skipped
            .iter()
            .map(|t| t.items.iter().map(|item| item.key.as_str()).collect())
            .collect();
        assert_eq!(keys, vec![vec!["2026/b.txt"], vec!["2026/photos/a.jpg"]]);
    }

    #[tokio::test]
    async fn the_same_path_dropped_twice_is_uploaded_once() {
        let (state, id) = state_with(Arc::new(FakeProvider::empty()), None).await;
        let dir = drop_folder();
        let twice = vec![dir.join("a.txt"), dir.join("a.txt")];
        assert_eq!(summarize(&twice).files, 1);
        assert_eq!(summarize(&twice).loose, 1);
        let transfers = upload_transfers(&state, id, "media", "", &twice, false)
            .await
            .unwrap();
        assert_eq!(transfers.len(), 1);
    }

    #[tokio::test]
    async fn a_path_that_vanished_stops_the_whole_drop() {
        let (state, id) = state_with(Arc::new(FakeProvider::empty()), None).await;
        let dir = drop_folder();
        let mut paths = dropped(&dir);
        paths.push(dir.join("gone.txt"));
        let refused = upload_transfers(&state, id, "media", "", &paths, false).await;
        assert_eq!(
            refused.map(|_| ()),
            Err(AppError::Io(
                "\"gone.txt\" is no longer there. Drop it again from Finder.".into()
            ))
        );
    }
}

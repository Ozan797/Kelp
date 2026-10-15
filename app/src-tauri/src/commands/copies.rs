use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::commands::browse::list_all;
use crate::commands::uploads::FolderPlan;
use crate::error::AppError;
use crate::state::AppState;
use crate::transfers::manager::TransferManager;
use crate::transfers::model::{Direction, Item, Kind, Source, Status, Transfer};
use crate::transfers::plan::folder_name;

const EXAMPLES: usize = 3;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyRequest {
    pub from: Uuid,
    pub from_bucket: String,
    pub keys: Vec<String>,
    pub to: Uuid,
    pub to_bucket: String,
    pub prefix: String,
}

struct Planned {
    kind: Kind,
    name: String,
    within: String,
    items: Vec<Item>,
}

fn copy_item(key: String, source_key: String, size: u64) -> Item {
    Item {
        source_key: Some(source_key),
        ..Item::pending(PathBuf::new(), key, size)
    }
}

async fn planned(state: &AppState, request: &CopyRequest) -> Result<Vec<Planned>, AppError> {
    let same = request.from == request.to && request.from_bucket == request.to_bucket;
    let inside_itself = request
        .keys
        .iter()
        .any(|key| key.ends_with('/') && same && request.prefix.starts_with(key.as_str()));
    if inside_itself {
        return Err(AppError::InvalidSettings(
            "A folder can't go inside itself.".into(),
        ));
    }
    let source = state.provider(request.from).await?;
    let mut planned = Vec::new();
    for key in &request.keys {
        let entry = if key.ends_with('/') {
            let name = folder_name(key);
            let objects = list_all(source.as_ref(), &request.from_bucket, key).await?;
            let items = objects
                .into_iter()
                .map(|object| {
                    let relative = object.key.strip_prefix(key.as_str()).unwrap_or(&object.key);
                    let to = format!("{}{name}/{relative}", request.prefix);
                    copy_item(to, object.key, object.size)
                })
                .collect();
            Planned {
                kind: Kind::Folder,
                within: format!("{}{name}/", request.prefix),
                name,
                items,
            }
        } else {
            let name = key.rsplit('/').next().unwrap_or(key).to_string();
            let page = source.list_keys(&request.from_bucket, key, None).await?;
            let size = page
                .objects
                .iter()
                .find(|object| &object.key == key)
                .map_or(0, |object| object.size);
            let to = format!("{}{name}", request.prefix);
            Planned {
                kind: Kind::File,
                within: to.clone(),
                name,
                items: vec![copy_item(to, key.clone(), size)],
            }
        };
        let items: Vec<Item> = entry
            .items
            .into_iter()
            .filter(|item| !(same && item.source_key.as_deref() == Some(item.key.as_str())))
            .collect();
        if !items.is_empty() {
            planned.push(Planned { items, ..entry });
        }
    }
    Ok(planned)
}

async fn with_clashes(
    state: &AppState,
    request: &CopyRequest,
) -> Result<Vec<(Planned, HashSet<String>)>, AppError> {
    let destination = state.provider(request.to).await?;
    let mut checked = Vec::new();
    for entry in planned(state, request).await? {
        let found = match entry.kind {
            Kind::Folder => {
                list_all(destination.as_ref(), &request.to_bucket, &entry.within).await?
            }
            Kind::File => {
                destination
                    .list_keys(&request.to_bucket, &entry.within, None)
                    .await?
                    .objects
            }
        };
        let present = found.into_iter().map(|object| object.key).collect();
        checked.push((entry, present));
    }
    Ok(checked)
}

pub async fn plan_copies(state: &AppState, request: &CopyRequest) -> Result<FolderPlan, AppError> {
    let checked = with_clashes(state, request).await?;
    let items: Vec<&Item> = checked.iter().flat_map(|(entry, _)| &entry.items).collect();
    let clashes: Vec<String> = checked
        .iter()
        .flat_map(|(entry, present)| {
            entry
                .items
                .iter()
                .filter(|item| present.contains(&item.key))
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

pub async fn copy_transfers(
    state: &AppState,
    request: &CopyRequest,
    skip_existing: bool,
    move_after: bool,
) -> Result<Vec<Transfer>, AppError> {
    let mut transfers = Vec::new();
    for (entry, present) in with_clashes(state, request).await? {
        let items: Vec<Item> = entry
            .items
            .into_iter()
            .filter(|item| !skip_existing || !present.contains(&item.key))
            .collect();
        if items.is_empty() {
            continue;
        }
        transfers.push(Transfer {
            id: Uuid::new_v4(),
            connection_id: request.to,
            direction: Direction::Copy,
            kind: entry.kind,
            name: entry.name,
            bucket: request.to_bucket.clone(),
            local_root: PathBuf::new(),
            remote_root: request.prefix.clone(),
            status: Status::Waiting,
            error: None,
            items,
            source: Some(Source {
                connection_id: request.from,
                bucket: request.from_bucket.clone(),
                move_after,
            }),
        });
    }
    Ok(transfers)
}

#[tauri::command]
pub async fn plan_copy(
    state: State<'_, AppState>,
    request: CopyRequest,
) -> Result<FolderPlan, AppError> {
    plan_copies(&state, &request).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_copy(
    state: State<'_, AppState>,
    transfers: State<'_, Arc<TransferManager>>,
    request: CopyRequest,
    skip_existing: bool,
    move_after: bool,
) -> Result<Vec<Uuid>, AppError> {
    let planned = copy_transfers(&state, &request, skip_existing, move_after).await?;
    let mut ids = Vec::new();
    for transfer in planned {
        ids.push(transfers.add(transfer).await);
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::error::AppError;
    use crate::testing::{FakeProvider, state_with_two};
    use crate::transfers::model::{Direction, Kind};

    fn source() -> FakeProvider {
        FakeProvider::empty().with_objects(vec![
            ("v/photos/a.jpg", b"aa".to_vec()),
            ("v/photos/raw/b.dng", b"bbb".to_vec()),
            ("v/teaser.mp4", b"t".to_vec()),
        ])
    }

    fn request(from: Uuid, to: Uuid, keys: &[&str], prefix: &str) -> CopyRequest {
        CopyRequest {
            from,
            from_bucket: "media".into(),
            keys: keys.iter().map(|key| key.to_string()).collect(),
            to,
            to_bucket: "cdn".into(),
            prefix: prefix.into(),
        }
    }

    #[tokio::test]
    async fn a_dragged_folder_keeps_its_name_under_the_destination() {
        let (state, from, to) =
            state_with_two(Arc::new(source()), Arc::new(FakeProvider::empty())).await;
        let made = copy_transfers(
            &state,
            &request(from, to, &["v/photos/", "v/teaser.mp4"], "web/"),
            false,
            true,
        )
        .await
        .unwrap();
        let shape: Vec<(Kind, Vec<(&str, &str)>)> = made
            .iter()
            .map(|t| {
                (
                    t.kind,
                    t.items
                        .iter()
                        .map(|i| (i.key.as_str(), i.source_key.as_deref().unwrap_or("")))
                        .collect(),
                )
            })
            .collect();
        assert_eq!(
            shape,
            vec![
                (
                    Kind::Folder,
                    vec![
                        ("web/photos/a.jpg", "v/photos/a.jpg"),
                        ("web/photos/raw/b.dng", "v/photos/raw/b.dng")
                    ]
                ),
                (Kind::File, vec![("web/teaser.mp4", "v/teaser.mp4")]),
            ]
        );
        let source = made[0].source.clone().unwrap();
        assert_eq!(
            (made[0].direction, source.connection_id, source.move_after),
            (Direction::Copy, from, true)
        );
        assert_eq!(
            (
                made[0].connection_id,
                made[0].bucket.as_str(),
                made[0].name.as_str()
            ),
            (to, "cdn", "photos")
        );
    }

    #[tokio::test]
    async fn clashes_at_the_destination_are_counted_and_can_be_skipped() {
        let destination = FakeProvider::empty().with_keys(vec!["web/photos/a.jpg".into()]);
        let (state, from, to) = state_with_two(Arc::new(source()), Arc::new(destination)).await;
        let ask = request(from, to, &["v/photos/"], "web/");
        let plan = plan_copies(&state, &ask).await.unwrap();
        assert_eq!((plan.files, plan.bytes, plan.existing), (2, 5, 1));
        assert_eq!(plan.examples, vec!["web/photos/a.jpg".to_string()]);
        let skipped = copy_transfers(&state, &ask, true, false).await.unwrap();
        assert_eq!(skipped[0].items.len(), 1);
    }

    #[tokio::test]
    async fn a_folder_never_goes_inside_itself() {
        let fake = Arc::new(source());
        let (state, from, _) = state_with_two(fake.clone(), Arc::new(FakeProvider::empty())).await;
        let mut ask = request(from, from, &["v/photos/"], "v/photos/raw/");
        ask.to_bucket = "media".into();
        let refused = plan_copies(&state, &ask).await;
        assert_eq!(
            refused,
            Err(AppError::InvalidSettings(
                "A folder can't go inside itself.".into()
            ))
        );
        assert_eq!(fake.calls("list_keys"), 0);
        ask.prefix = "v/photos/".into();
        assert!(copy_transfers(&state, &ask, false, true).await.is_err());
    }

    #[tokio::test]
    async fn moving_files_onto_the_folder_they_are_in_does_nothing() {
        let (state, from, _) =
            state_with_two(Arc::new(source()), Arc::new(FakeProvider::empty())).await;
        let mut ask = request(from, from, &["v/teaser.mp4"], "v/");
        ask.to_bucket = "media".into();
        assert!(
            copy_transfers(&state, &ask, false, true)
                .await
                .unwrap()
                .is_empty()
        );
    }
}

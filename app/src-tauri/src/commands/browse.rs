use tauri::State;
use uuid::Uuid;

use crate::error::AppError;
use crate::providers::{ListPage, ObjectMeta, StorageProvider};
use crate::state::AppState;

pub fn folder_key(prefix: &str, name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidSettings(
            "Enter a name for the folder.".into(),
        ));
    }
    if name.contains('/') {
        return Err(AppError::InvalidSettings(
            "Folder names can't contain a slash (/).".into(),
        ));
    }
    if name == "." || name == ".." {
        return Err(AppError::InvalidSettings(
            "Folder names can't be \".\" or \"..\".".into(),
        ));
    }
    Ok(format!("{prefix}{name}/"))
}

pub async fn buckets(state: &AppState, id: Uuid) -> Result<Vec<String>, AppError> {
    if let Some(bucket) = state.profile(id).await?.bucket {
        return Ok(vec![bucket]);
    }
    state.provider(id).await?.list_buckets().await
}

pub async fn list_all(
    provider: &dyn StorageProvider,
    bucket: &str,
    prefix: &str,
) -> Result<Vec<ObjectMeta>, AppError> {
    let mut objects = Vec::new();
    let mut token = None;
    loop {
        let page = provider.list_keys(bucket, prefix, token).await?;
        objects.extend(page.objects);
        token = page.next_token;
        if token.is_none() {
            return Ok(objects);
        }
    }
}

pub async fn delete_keys(
    state: &AppState,
    id: Uuid,
    bucket: &str,
    keys: Vec<String>,
) -> Result<u64, AppError> {
    let provider = state.provider(id).await?;
    let mut targets = Vec::new();
    for key in keys {
        if key.ends_with('/') {
            let inside = list_all(provider.as_ref(), bucket, &key).await?;
            targets.extend(inside.into_iter().map(|object| object.key));
        }
        targets.push(key);
    }
    targets.sort();
    targets.dedup();
    provider.delete(bucket, &targets).await?;
    Ok(targets.len() as u64)
}

#[tauri::command]
pub async fn list_buckets(state: State<'_, AppState>, id: Uuid) -> Result<Vec<String>, AppError> {
    buckets(&state, id).await
}

#[tauri::command]
pub async fn list_objects(
    state: State<'_, AppState>,
    id: Uuid,
    bucket: String,
    prefix: String,
    token: Option<String>,
) -> Result<ListPage, AppError> {
    state
        .provider(id)
        .await?
        .list(&bucket, &prefix, token)
        .await
}

#[tauri::command]
pub async fn create_folder(
    state: State<'_, AppState>,
    id: Uuid,
    bucket: String,
    prefix: String,
    name: String,
) -> Result<String, AppError> {
    let key = folder_key(&prefix, &name)?;
    state
        .provider(id)
        .await?
        .create_folder(&bucket, &key)
        .await?;
    Ok(key)
}

#[tauri::command]
pub async fn delete_objects(
    state: State<'_, AppState>,
    id: Uuid,
    bucket: String,
    keys: Vec<String>,
) -> Result<u64, AppError> {
    delete_keys(&state, id, &bucket, keys).await
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::testing::{FakeProvider, state_with};

    #[test]
    fn folder_names_are_trimmed() {
        assert_eq!(folder_key("vimeo/", " 2026 "), Ok("vimeo/2026/".into()));
        assert_eq!(folder_key("", "drafts"), Ok("drafts/".into()));
    }

    #[test]
    fn empty_and_blank_folder_names_are_rejected() {
        for bad in ["", "   "] {
            assert!(
                matches!(folder_key("vimeo/", bad), Err(AppError::InvalidSettings(_))),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn folder_names_with_a_slash_are_rejected() {
        for bad in ["a/b", "/", " a/ ", "a/"] {
            assert!(
                matches!(folder_key("vimeo/", bad), Err(AppError::InvalidSettings(_))),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn dot_folder_names_are_rejected() {
        for bad in [".", "..", " .. "] {
            assert!(
                matches!(folder_key("vimeo/", bad), Err(AppError::InvalidSettings(_))),
                "{bad:?}"
            );
        }
        assert_eq!(folder_key("", ".hidden"), Ok(".hidden/".into()));
    }

    #[tokio::test]
    async fn a_key_limited_to_one_bucket_shows_only_that_bucket() {
        let fake = Arc::new(FakeProvider::new(
            Err(AppError::AccessDenied),
            Ok(ListPage::default()),
        ));
        let (state, id) = state_with(fake, Some("media-archive")).await;
        assert_eq!(buckets(&state, id).await, Ok(vec!["media-archive".into()]));
    }

    #[tokio::test]
    async fn other_keys_list_their_buckets() {
        let fake = Arc::new(FakeProvider::new(
            Ok(vec!["a".into(), "b".into()]),
            Ok(ListPage::default()),
        ));
        let (state, id) = state_with(fake, None).await;
        assert_eq!(buckets(&state, id).await, Ok(vec!["a".into(), "b".into()]));
    }

    #[tokio::test]
    async fn deleting_a_folder_deletes_everything_inside_it() {
        let fake = Arc::new(
            FakeProvider::new(Ok(vec![]), Ok(ListPage::default())).with_keys(vec![
                "vimeo/2025/".into(),
                "vimeo/2025/a.mp4".into(),
                "vimeo/2025/raw/b.mov".into(),
                "vimeo/other.txt".into(),
            ]),
        );
        let (state, id) = state_with(fake.clone(), None).await;
        let count = delete_keys(
            &state,
            id,
            "media",
            vec!["vimeo/2025/".into(), "vimeo/notes.md".into()],
        )
        .await
        .unwrap();
        assert_eq!(count, 4);
        let mut deleted = fake.deleted();
        deleted.sort();
        assert_eq!(
            deleted,
            vec![
                "vimeo/2025/",
                "vimeo/2025/a.mp4",
                "vimeo/2025/raw/b.mov",
                "vimeo/notes.md"
            ]
        );
    }
}

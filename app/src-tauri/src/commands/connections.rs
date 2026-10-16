use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::connection::ConnectionSettings;
use crate::error::AppError;
use crate::profiles::{ConnectionProfile, Location};
use crate::state::AppState;
use crate::validation::{CheckResult, check_connection};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDraft {
    pub id: Option<Uuid>,
    pub name: String,
    pub settings: ConnectionSettings,
    pub bucket: Option<String>,
    pub secret: Option<String>,
}

fn required(value: &str, message: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidSettings(message.into()));
    }
    Ok(trimmed.to_string())
}

async fn secret_for(state: &AppState, draft: &ConnectionDraft) -> Result<String, AppError> {
    let typed = draft
        .secret
        .as_deref()
        .map(str::trim)
        .filter(|secret| !secret.is_empty());
    match (typed, draft.id) {
        (Some(secret), _) => Ok(secret.to_string()),
        (None, Some(id)) => state.secret(id).await,
        (None, None) => Err(AppError::InvalidSettings("Enter the secret key.".into())),
    }
}

pub async fn list(state: &AppState) -> Result<Vec<ConnectionProfile>, AppError> {
    state.ensure_loaded()?;
    Ok(state.profiles.lock().await.clone())
}

pub async fn test(state: &AppState, draft: &ConnectionDraft) -> Result<CheckResult, AppError> {
    required(&draft.name, "Enter a name for this connection.")?;
    required(&draft.settings.access_key_id, "Enter the access key.")?;
    let secret = secret_for(state, draft).await?;
    let provider = (state.connect)(&draft.settings, &secret)?;
    check_connection(provider.as_ref(), draft.bucket.as_deref()).await
}

pub async fn save(state: &AppState, draft: ConnectionDraft) -> Result<ConnectionProfile, AppError> {
    state.ensure_loaded()?;
    let name = required(&draft.name, "Enter a name for this connection.")?;
    let check = test(state, &draft).await?;
    let secret = secret_for(state, &draft).await?;
    let id = draft.id.unwrap_or_else(Uuid::new_v4);

    let mut profiles = state.profiles.lock().await;
    let existing = profiles.iter().position(|profile| profile.id == id);
    if draft.id.is_some() && existing.is_none() {
        return Err(AppError::ConnectionNotFound);
    }
    let profile = ConnectionProfile {
        id,
        name,
        settings: draft.settings.normalised()?,
        bucket: if check.limited_to_bucket {
            check.buckets.first().cloned()
        } else {
            None
        },
        last_location: existing.and_then(|index| profiles[index].last_location.clone()),
    };

    let mut next = profiles.clone();
    match existing {
        Some(index) => next[index] = profile.clone(),
        None => next.push(profile.clone()),
    }

    let previous_secret = state.secret(id).await.ok();
    state.set_secret(id, secret).await?;
    if let Err(error) = state.store.save(&next) {
        match previous_secret {
            Some(previous) => state.set_secret(id, previous).await.ok(),
            None => state.delete_secret(id).await.ok(),
        };
        return Err(error);
    }
    *profiles = next;
    drop(profiles);
    state.forget_provider(id).await;
    Ok(profile)
}

pub async fn delete(state: &AppState, id: Uuid) -> Result<(), AppError> {
    state.ensure_loaded()?;
    let mut profiles = state.profiles.lock().await;
    let next: Vec<ConnectionProfile> = profiles
        .iter()
        .filter(|profile| profile.id != id)
        .cloned()
        .collect();
    state.store.save(&next)?;
    *profiles = next;
    drop(profiles);
    state.delete_secret(id).await?;
    state.forget_provider(id).await;
    Ok(())
}

pub async fn remember_location(
    state: &AppState,
    id: Uuid,
    location: Option<Location>,
) -> Result<(), AppError> {
    state.ensure_loaded()?;
    let mut profiles = state.profiles.lock().await;
    let mut next = profiles.clone();
    let profile = next
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or(AppError::ConnectionNotFound)?;
    profile.last_location = location;
    state.store.save(&next)?;
    *profiles = next;
    Ok(())
}

#[tauri::command]
pub async fn list_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionProfile>, AppError> {
    list(&state).await
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    draft: ConnectionDraft,
) -> Result<CheckResult, AppError> {
    test(&state, &draft).await
}

#[tauri::command]
pub async fn save_connection(
    state: State<'_, AppState>,
    draft: ConnectionDraft,
) -> Result<ConnectionProfile, AppError> {
    save(&state, draft).await
}

#[tauri::command]
pub async fn delete_connection(state: State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
    delete(&state, id).await
}

#[tauri::command]
pub async fn set_last_location(
    state: State<'_, AppState>,
    id: Uuid,
    location: Option<Location>,
) -> Result<(), AppError> {
    remember_location(&state, id, location).await
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use super::*;
    use crate::connection::ProviderKind;
    use crate::profiles::ProfileStore;
    use crate::providers::ListPage;
    use crate::secrets::{MemoryStore, SecretStore};
    use crate::testing::FakeProvider;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kelp-commands-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn state_with(
        dir: PathBuf,
        buckets: Result<Vec<String>, AppError>,
        listing: Result<ListPage, AppError>,
    ) -> AppState {
        let connect: crate::state::Connect = Box::new(move |_, _| {
            Ok(Arc::new(FakeProvider::new(
                buckets.clone(),
                listing.clone(),
            )))
        });
        AppState::new(
            ProfileStore::new(&dir),
            Arc::new(MemoryStore::default()),
            connect,
        )
    }

    fn working(dir: PathBuf) -> AppState {
        state_with(dir, Ok(vec!["media".into()]), Ok(ListPage::default()))
    }

    fn draft(name: &str, secret: Option<&str>) -> ConnectionDraft {
        ConnectionDraft {
            id: None,
            name: name.into(),
            settings: ConnectionSettings {
                kind: ProviderKind::Hetzner,
                endpoint: None,
                region: "hel1".into(),
                path_style: false,
                access_key_id: "AKIDEXAMPLE".into(),
            },
            bucket: None,
            secret: secret.map(String::from),
        }
    }

    #[tokio::test]
    async fn saving_after_a_passing_check_stores_profile_and_secret() {
        let dir = temp_dir();
        let state = working(dir.clone());
        let profile = save(&state, draft(" media ", Some("s3cret")))
            .await
            .unwrap();
        assert_eq!(profile.name, "media");
        assert_eq!(state.secrets.get(&profile.id).unwrap(), "s3cret");
        assert_eq!(list(&state).await.unwrap().len(), 1);
        let json = std::fs::read_to_string(dir.join("connections.json")).unwrap();
        assert!(!json.contains("s3cret"));
    }

    #[tokio::test]
    async fn a_pasted_hetzner_endpoint_is_saved_as_its_location() {
        let state = working(temp_dir());
        let mut pasted = draft("media", Some("s"));
        pasted.settings.region = "https://hel1.your-objectstorage.com/".into();
        let profile = save(&state, pasted).await.unwrap();
        assert_eq!(profile.settings.region, "hel1");
        assert_eq!(list(&state).await.unwrap()[0].settings.region, "hel1");
    }

    #[tokio::test]
    async fn bad_keys_are_never_saved() {
        let dir = temp_dir();
        let state = state_with(
            dir.clone(),
            Err(AppError::BadCredentials),
            Ok(ListPage::default()),
        );
        let result = save(&state, draft("media", Some("wrong"))).await;
        assert!(matches!(result, Err(AppError::BadCredentials)));
        assert!(list(&state).await.unwrap().is_empty());
        assert!(!dir.join("connections.json").exists());
    }

    #[tokio::test]
    async fn a_name_and_keys_are_required() {
        let state = working(temp_dir());
        assert!(matches!(
            save(&state, draft("  ", Some("s"))).await,
            Err(AppError::InvalidSettings(_))
        ));
        assert!(matches!(
            save(&state, draft("media", None)).await,
            Err(AppError::InvalidSettings(_))
        ));
        let mut no_key = draft("media", Some("s"));
        no_key.settings.access_key_id = " ".into();
        assert!(matches!(
            save(&state, no_key).await,
            Err(AppError::InvalidSettings(_))
        ));
    }

    #[tokio::test]
    async fn testing_also_requires_a_name() {
        let state = working(temp_dir());
        assert!(matches!(
            test(&state, &draft("  ", Some("s"))).await,
            Err(AppError::InvalidSettings(_))
        ));
    }

    #[tokio::test]
    async fn a_key_limited_to_one_bucket_remembers_it() {
        let state = state_with(
            temp_dir(),
            Err(AppError::AccessDenied),
            Ok(ListPage::default()),
        );
        let mut limited = draft("media", Some("s"));
        limited.bucket = Some("media-archive".into());
        let profile = save(&state, limited).await.unwrap();
        assert_eq!(profile.bucket, Some("media-archive".into()));
    }

    #[tokio::test]
    async fn editing_without_a_new_secret_keeps_the_stored_one() {
        let state = working(temp_dir());
        let saved = save(&state, draft("media", Some("original")))
            .await
            .unwrap();
        let mut edit = draft("renamed", None);
        edit.id = Some(saved.id);
        save(&state, edit).await.unwrap();
        assert_eq!(state.secrets.get(&saved.id).unwrap(), "original");
        assert_eq!(list(&state).await.unwrap()[0].name, "renamed");
        assert_eq!(list(&state).await.unwrap().len(), 1);
    }

    struct CancellingStore;

    impl SecretStore for CancellingStore {
        fn get(&self, _: &Uuid) -> Result<String, AppError> {
            Err(AppError::KeychainCancelled)
        }
        fn set(&self, _: &Uuid, _: &str) -> Result<(), AppError> {
            Err(AppError::KeychainCancelled)
        }
        fn delete(&self, _: &Uuid) -> Result<(), AppError> {
            Err(AppError::KeychainCancelled)
        }
    }

    #[tokio::test]
    async fn a_cancelled_touch_id_prompt_saves_nothing() {
        let dir = temp_dir();
        let connect: crate::state::Connect = Box::new(|_, _| {
            Ok(Arc::new(FakeProvider::new(
                Ok(vec!["media".into()]),
                Ok(ListPage::default()),
            )))
        });
        let state = AppState::new(ProfileStore::new(&dir), Arc::new(CancellingStore), connect);
        let error = save(&state, draft("media", Some("s3cret")))
            .await
            .unwrap_err();
        assert_eq!(error, AppError::KeychainCancelled);
        assert!(list(&state).await.unwrap().is_empty());
        assert!(!dir.join("connections.json").exists());
    }

    #[tokio::test]
    async fn a_failed_profile_write_removes_the_new_secret() {
        let blocker = temp_dir().join("not-a-folder");
        let secrets = Arc::new(MemoryStore::default());
        let connect: crate::state::Connect = Box::new(|_, _| {
            Ok(Arc::new(FakeProvider::new(
                Ok(vec!["media".into()]),
                Ok(ListPage::default()),
            )))
        });
        let state = AppState::new(
            ProfileStore::new(&blocker.join("inside")),
            secrets.clone(),
            connect,
        );
        std::fs::write(&blocker, "file in the way").unwrap();
        let error = save(&state, draft("media", Some("s3cret")))
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::Io(_)));
        assert!(list(&state).await.unwrap().is_empty());
        assert_eq!(secrets.count(), 0);
    }

    #[tokio::test]
    async fn a_failed_edit_keeps_the_original_secret_and_file() {
        let dir = temp_dir();
        let state = working(dir.clone());
        let saved = save(&state, draft("media", Some("original")))
            .await
            .unwrap();
        let before = std::fs::read_to_string(dir.join("connections.json")).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
        let mut edit = draft("renamed", Some("new"));
        edit.id = Some(saved.id);
        let error = save(&state, edit).await.unwrap_err();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(error, AppError::Io(_)));
        assert_eq!(state.secrets.get(&saved.id).unwrap(), "original");
        assert_eq!(list(&state).await.unwrap()[0].name, "media");
        let after = std::fs::read_to_string(dir.join("connections.json")).unwrap();
        assert_eq!(before, after);
    }

    #[tokio::test]
    async fn editing_a_connection_that_does_not_exist_fails() {
        let state = working(temp_dir());
        let mut edit = draft("media", Some("s"));
        let id = Uuid::new_v4();
        edit.id = Some(id);
        let result = save(&state, edit).await;
        assert!(matches!(result, Err(AppError::ConnectionNotFound)));
        assert!(list(&state).await.unwrap().is_empty());
        assert!(state.secrets.get(&id).is_err());
    }

    #[tokio::test]
    async fn deleting_removes_profile_and_secret() {
        let state = working(temp_dir());
        let saved = save(&state, draft("media", Some("s"))).await.unwrap();
        delete(&state, saved.id).await.unwrap();
        assert!(list(&state).await.unwrap().is_empty());
        assert!(state.secrets.get(&saved.id).is_err());
    }

    #[tokio::test]
    async fn a_damaged_file_is_reported_and_never_overwritten() {
        let dir = temp_dir();
        std::fs::write(dir.join("connections.json"), "{ not json").unwrap();
        let state = working(dir.clone());
        let damaged = list(&state).await.unwrap_err();
        assert!(matches!(&damaged, AppError::Io(message) if message.contains("connections.json")));
        assert_eq!(
            save(&state, draft("media", Some("s"))).await.unwrap_err(),
            damaged
        );
        assert_eq!(delete(&state, Uuid::new_v4()).await.unwrap_err(), damaged);
        assert_eq!(
            remember_location(&state, Uuid::new_v4(), None)
                .await
                .unwrap_err(),
            damaged
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("connections.json")).unwrap(),
            "{ not json"
        );
    }

    #[tokio::test]
    async fn the_last_location_is_saved() {
        let state = working(temp_dir());
        let saved = save(&state, draft("media", Some("s"))).await.unwrap();
        let place = Location {
            bucket: "media".into(),
            prefix: "vimeo/".into(),
        };
        remember_location(&state, saved.id, Some(place.clone()))
            .await
            .unwrap();
        assert_eq!(
            state.profile(saved.id).await.unwrap().last_location,
            Some(place)
        );
    }
}

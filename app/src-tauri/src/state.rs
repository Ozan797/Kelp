use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;
use uuid::Uuid;

use crate::connection::ConnectionSettings;
use crate::error::AppError;
use crate::profiles::{ConnectionProfile, ProfileStore};
use crate::providers::StorageProvider;
use crate::providers::s3::S3Provider;
use crate::secrets::SecretStore;

pub type Connect = Box<
    dyn Fn(&ConnectionSettings, &str) -> Result<Arc<dyn StorageProvider>, AppError> + Send + Sync,
>;

pub struct AppState {
    pub store: ProfileStore,
    pub secrets: Arc<dyn SecretStore>,
    pub connect: Connect,
    pub profiles: Mutex<Vec<ConnectionProfile>>,
    load_error: Option<AppError>,
    providers: Mutex<HashMap<Uuid, Arc<dyn StorageProvider>>>,
}

pub fn real_connect() -> Connect {
    Box::new(|settings, secret| Ok(Arc::new(S3Provider::new(settings, secret)?)))
}

impl AppState {
    pub fn new(store: ProfileStore, secrets: Arc<dyn SecretStore>, connect: Connect) -> Self {
        let (profiles, load_error) = match store.load() {
            Ok(profiles) => (profiles, None),
            Err(error) => (Vec::new(), Some(error)),
        };
        Self {
            store,
            secrets,
            connect,
            profiles: Mutex::new(profiles),
            load_error,
            providers: Mutex::new(HashMap::new()),
        }
    }

    pub fn ensure_loaded(&self) -> Result<(), AppError> {
        match &self.load_error {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }

    pub async fn profile(&self, id: Uuid) -> Result<ConnectionProfile, AppError> {
        self.profiles
            .lock()
            .await
            .iter()
            .find(|profile| profile.id == id)
            .cloned()
            .ok_or(AppError::ConnectionNotFound)
    }

    pub async fn provider(&self, id: Uuid) -> Result<Arc<dyn StorageProvider>, AppError> {
        if let Some(provider) = self.providers.lock().await.get(&id) {
            return Ok(provider.clone());
        }
        let profile = self.profile(id).await?;
        let secret = self.secret(id).await?;
        let provider = (self.connect)(&profile.settings, &secret)?;
        self.providers.lock().await.insert(id, provider.clone());
        Ok(provider)
    }

    async fn with_secrets<T: Send + 'static>(
        &self,
        work: impl FnOnce(&dyn SecretStore) -> Result<T, AppError> + Send + 'static,
    ) -> Result<T, AppError> {
        let secrets = self.secrets.clone();
        tokio::task::spawn_blocking(move || work(secrets.as_ref()))
            .await
            .map_err(|_| AppError::Keychain("the secret store is unavailable".into()))?
    }

    pub async fn secret(&self, id: Uuid) -> Result<String, AppError> {
        self.with_secrets(move |secrets| secrets.get(&id)).await
    }

    pub async fn set_secret(&self, id: Uuid, secret: String) -> Result<(), AppError> {
        self.with_secrets(move |secrets| secrets.set(&id, &secret))
            .await
    }

    pub async fn delete_secret(&self, id: Uuid) -> Result<(), AppError> {
        self.with_secrets(move |secrets| secrets.delete(&id)).await
    }

    pub async fn forget_provider(&self, id: Uuid) {
        self.providers.lock().await.remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;

    fn state() -> AppState {
        let dir = std::env::temp_dir().join(format!("kelp-state-{}", Uuid::new_v4()));
        AppState::new(
            ProfileStore::new(&dir),
            Arc::new(MemoryStore::default()),
            real_connect(),
        )
    }

    #[tokio::test]
    async fn secrets_round_trip_through_the_blocking_helpers() {
        let state = state();
        let id = Uuid::new_v4();
        state.set_secret(id, "s3cret".into()).await.unwrap();
        assert_eq!(state.secret(id).await.unwrap(), "s3cret");
        state.delete_secret(id).await.unwrap();
        assert!(state.secret(id).await.is_err());
    }
}

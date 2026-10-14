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
    pub secrets: Box<dyn SecretStore>,
    pub connect: Connect,
    pub profiles: Mutex<Vec<ConnectionProfile>>,
    load_error: Option<AppError>,
    providers: Mutex<HashMap<Uuid, Arc<dyn StorageProvider>>>,
}

pub fn real_connect() -> Connect {
    Box::new(|settings, secret| Ok(Arc::new(S3Provider::new(settings, secret)?)))
}

impl AppState {
    pub fn new(store: ProfileStore, secrets: Box<dyn SecretStore>, connect: Connect) -> Self {
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
        let secret = self.secrets.get(&id)?;
        let provider = (self.connect)(&profile.settings, &secret)?;
        self.providers.lock().await.insert(id, provider.clone());
        Ok(provider)
    }

    pub async fn forget_provider(&self, id: Uuid) {
        self.providers.lock().await.remove(&id);
    }
}

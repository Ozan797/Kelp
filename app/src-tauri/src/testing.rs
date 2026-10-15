use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::Mutex;

use async_trait::async_trait;
use tokio::sync::watch;

use std::sync::Arc;

use uuid::Uuid;

use crate::connection::{ConnectionSettings, ProviderKind};
use crate::error::AppError;
use crate::profiles::{ConnectionProfile, ProfileStore};
use crate::providers::{KeyPage, ListPage, ProgressFn, StorageProvider};
use crate::secrets::MemoryStore;
use crate::state::AppState;

pub struct FakeProvider {
    buckets: Result<Vec<String>, AppError>,
    listing: Result<ListPage, AppError>,
    keys: Vec<String>,
    deleted: Mutex<Vec<String>>,
    objects: Mutex<BTreeMap<String, Vec<u8>>>,
    failures: Mutex<Vec<AppError>>,
    calls: Mutex<HashMap<&'static str, usize>>,
    held: watch::Sender<bool>,
}

#[async_trait]
impl StorageProvider for FakeProvider {
    async fn list(&self, _: &str, _: &str, _: Option<String>) -> Result<ListPage, AppError> {
        self.listing.clone()
    }
    async fn list_buckets(&self) -> Result<Vec<String>, AppError> {
        self.buckets.clone()
    }
    async fn list_keys(
        &self,
        _: &str,
        prefix: &str,
        _: Option<String>,
    ) -> Result<KeyPage, AppError> {
        let stored = lock(&self.objects).keys().cloned().collect::<Vec<_>>();
        Ok(KeyPage {
            keys: self
                .keys
                .iter()
                .cloned()
                .chain(stored)
                .filter(|key| key.starts_with(prefix))
                .collect(),
            next_token: None,
        })
    }
    async fn delete(&self, _: &str, keys: &[String]) -> Result<(), AppError> {
        lock(&self.deleted).extend(keys.iter().cloned());
        let mut objects = lock(&self.objects);
        for key in keys {
            objects.remove(key);
        }
        Ok(())
    }
    async fn create_folder(&self, _: &str, _: &str) -> Result<(), AppError> {
        Ok(())
    }
    async fn put_file(
        &self,
        _: &str,
        key: &str,
        path: &Path,
        progress: ProgressFn,
    ) -> Result<(), AppError> {
        self.enter("put_file").await?;
        let bytes = std::fs::read(path)?;
        progress(bytes.len() as u64);
        lock(&self.objects).insert(key.to_string(), bytes);
        Ok(())
    }
    async fn get_file(
        &self,
        _: &str,
        key: &str,
        path: &Path,
        progress: ProgressFn,
    ) -> Result<(), AppError> {
        self.enter("get_file").await?;
        let bytes = self
            .object(key)
            .ok_or_else(|| AppError::Provider("NoSuchKey".into()))?;
        std::fs::write(path, &bytes)?;
        progress(bytes.len() as u64);
        Ok(())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl FakeProvider {
    pub fn new(
        buckets: Result<Vec<String>, AppError>,
        listing: Result<ListPage, AppError>,
    ) -> Self {
        Self {
            buckets,
            listing,
            keys: Vec::new(),
            deleted: Mutex::new(Vec::new()),
            objects: Mutex::new(BTreeMap::new()),
            failures: Mutex::new(Vec::new()),
            calls: Mutex::new(HashMap::new()),
            held: watch::channel(false).0,
        }
    }

    pub fn empty() -> Self {
        Self::new(Ok(Vec::new()), Ok(ListPage::default()))
    }

    pub fn with_keys(mut self, keys: Vec<String>) -> Self {
        self.keys = keys;
        self
    }

    pub fn with_objects(self, objects: Vec<(&str, Vec<u8>)>) -> Self {
        lock(&self.objects).extend(
            objects
                .into_iter()
                .map(|(key, bytes)| (key.to_string(), bytes)),
        );
        self
    }

    pub fn deleted(&self) -> Vec<String> {
        lock(&self.deleted).clone()
    }

    pub fn object(&self, key: &str) -> Option<Vec<u8>> {
        lock(&self.objects).get(key).cloned()
    }

    pub fn fail_next(&self, count: usize, error: AppError) {
        lock(&self.failures).extend(std::iter::repeat_n(error, count));
    }

    pub fn calls(&self, name: &str) -> usize {
        lock(&self.calls).get(name).copied().unwrap_or(0)
    }

    pub fn hold(&self) {
        self.held.send_replace(true);
    }

    pub fn release(&self) {
        self.held.send_replace(false);
    }

    async fn enter(&self, name: &'static str) -> Result<(), AppError> {
        *lock(&self.calls).entry(name).or_insert(0) += 1;
        let mut held = self.held.subscribe();
        held.wait_for(|held| !*held)
            .await
            .map_err(|_| AppError::Network)?;
        let mut failures = lock(&self.failures);
        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.remove(0))
        }
    }
}

pub async fn state_with(fake: Arc<FakeProvider>, bucket: Option<&str>) -> (AppState, Uuid) {
    let dir = std::env::temp_dir().join(format!("kelp-state-{}", Uuid::new_v4()));
    let shared = fake.clone();
    let state = AppState::new(
        ProfileStore::new(&dir),
        Box::new(MemoryStore::default()),
        Box::new(move |_, _| Ok(shared.clone())),
    );
    let id = Uuid::new_v4();
    state.secrets.set(&id, "s").unwrap();
    state.profiles.lock().await.push(ConnectionProfile {
        id,
        name: "media".into(),
        settings: ConnectionSettings {
            kind: ProviderKind::Hetzner,
            endpoint: None,
            region: "hel1".into(),
            path_style: false,
            access_key_id: "AKIDEXAMPLE".into(),
        },
        bucket: bucket.map(String::from),
        last_location: None,
    });
    (state, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake() -> FakeProvider {
        FakeProvider::new(Ok(Vec::new()), Ok(ListPage::default()))
    }

    fn temp_file(bytes: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("kelp-fake-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn no_progress() -> ProgressFn {
        Arc::new(|_| {})
    }

    #[tokio::test]
    async fn uploaded_files_can_be_read_back() {
        let provider = fake();
        provider
            .put_file("b", "2026/a.txt", &temp_file(b"hello"), no_progress())
            .await
            .unwrap();
        assert_eq!(provider.object("2026/a.txt"), Some(b"hello".to_vec()));
        assert_eq!(provider.calls("put_file"), 1);
        let keys = provider.list_keys("b", "2026/", None).await.unwrap().keys;
        assert_eq!(keys, vec!["2026/a.txt".to_string()]);
    }

    #[tokio::test]
    async fn downloads_write_the_stored_bytes() {
        let provider = fake().with_objects(vec![("a.txt", b"hi".to_vec())]);
        let target = temp_file(b"");
        provider
            .get_file("b", "a.txt", &target, no_progress())
            .await
            .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"hi");
    }

    #[tokio::test]
    async fn it_fails_the_next_calls_on_cue_then_works() {
        let provider = fake();
        provider.fail_next(2, AppError::Network);
        let path = temp_file(b"x");
        for _ in 0..2 {
            let result = provider.put_file("b", "x", &path, no_progress()).await;
            assert_eq!(result, Err(AppError::Network));
        }
        assert!(
            provider
                .put_file("b", "x", &path, no_progress())
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn held_calls_wait_until_released() {
        let provider = Arc::new(fake());
        provider.hold();
        let path = temp_file(b"x");
        let task = {
            let provider = provider.clone();
            tokio::spawn(async move { provider.put_file("b", "x", &path, no_progress()).await })
        };
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(!task.is_finished());
        provider.release();
        assert!(task.await.unwrap().is_ok());
    }
}

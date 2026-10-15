use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Seek, SeekFrom, Write};
use std::ops::Range;
use std::path::Path;
use std::sync::Mutex;

use async_trait::async_trait;
use tokio::sync::watch;

use std::sync::Arc;

use uuid::Uuid;

use crate::connection::{ConnectionSettings, ProviderKind};
use crate::error::AppError;
use crate::profiles::{ConnectionProfile, ProfileStore};
use crate::providers::{
    CompletedPart, KeyPage, ListPage, ObjectInfo, ObjectMeta, ObjectRef, PartTarget, ProgressFn,
    StorageProvider,
};
use crate::secrets::MemoryStore;
use crate::state::AppState;

type Upload = (String, BTreeMap<u32, Vec<u8>>);

pub struct FakeProvider {
    buckets: Result<Vec<String>, AppError>,
    listing: Result<ListPage, AppError>,
    keys: Vec<String>,
    deleted: Mutex<Vec<String>>,
    objects: Mutex<BTreeMap<String, Vec<u8>>>,
    failures: Mutex<Vec<AppError>>,
    calls: Mutex<HashMap<&'static str, usize>>,
    held: watch::Sender<bool>,
    etags: Mutex<HashMap<String, String>>,
    uploads: Mutex<HashMap<String, Upload>>,
    page_size: usize,
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
        token: Option<String>,
    ) -> Result<KeyPage, AppError> {
        self.enter("list_keys").await?;
        let stored: Vec<ObjectMeta> = lock(&self.objects)
            .iter()
            .map(|(key, bytes)| meta(key, bytes.len() as u64))
            .collect();
        let matching: Vec<ObjectMeta> = self
            .keys
            .iter()
            .map(|key| meta(key, 0))
            .chain(stored)
            .filter(|object| object.key.starts_with(prefix))
            .collect();
        let start = token.and_then(|token| token.parse().ok()).unwrap_or(0);
        let end = (start + self.page_size).min(matching.len());
        Ok(KeyPage {
            objects: matching.get(start..end).unwrap_or_default().to_vec(),
            next_token: (end < matching.len()).then(|| end.to_string()),
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
    async fn head(&self, _: &str, key: &str) -> Result<ObjectInfo, AppError> {
        self.enter("head").await?;
        let size = self
            .object(key)
            .ok_or_else(|| AppError::Provider("NoSuchKey".into()))?
            .len() as u64;
        Ok(ObjectInfo {
            size,
            etag: self.etag(key),
        })
    }
    async fn start_multipart(&self, _: &str, key: &str) -> Result<String, AppError> {
        let upload_id = {
            let mut uploads = lock(&self.uploads);
            let upload_id = format!("up-{}", self.calls("start_multipart") + 1);
            uploads.insert(upload_id.clone(), (key.to_string(), BTreeMap::new()));
            upload_id
        };
        if let Err(error) = self.enter("start_multipart").await {
            lock(&self.uploads).remove(&upload_id);
            return Err(error);
        }
        Ok(upload_id)
    }
    async fn put_part(
        &self,
        target: &PartTarget<'_>,
        number: u32,
        path: &Path,
        offset: u64,
        len: u64,
        progress: ProgressFn,
    ) -> Result<String, AppError> {
        self.enter("put_part").await?;
        let mut bytes = vec![0; usize::try_from(len).map_err(|_| AppError::FileTooLarge)?];
        let mut file = std::fs::File::open(path)?;
        file.seek(SeekFrom::Start(offset))?;
        file.read_exact(&mut bytes)?;
        progress(len);
        self.store_part(target, number, bytes)
    }
    async fn complete_multipart(
        &self,
        target: &PartTarget<'_>,
        parts: &[CompletedPart],
    ) -> Result<(), AppError> {
        self.enter("complete_multipart").await?;
        let (key, stored) = lock(&self.uploads)
            .remove(target.upload_id)
            .ok_or(AppError::UploadGone)?;
        let mut numbers: Vec<u32> = parts.iter().map(|part| part.number).collect();
        numbers.sort_unstable();
        let joined = numbers
            .iter()
            .filter_map(|number| stored.get(number))
            .flatten()
            .copied()
            .collect();
        lock(&self.objects).insert(key, joined);
        Ok(())
    }
    async fn abort_multipart(&self, target: &PartTarget<'_>) -> Result<(), AppError> {
        self.enter("abort_multipart").await?;
        lock(&self.uploads).remove(target.upload_id);
        Ok(())
    }
    async fn copy_object(&self, from: &ObjectRef<'_>, to: &ObjectRef<'_>) -> Result<(), AppError> {
        self.enter("copy_object").await?;
        let bytes = self
            .object(from.key)
            .ok_or_else(|| AppError::Provider("NoSuchKey".into()))?;
        lock(&self.objects).insert(to.key.to_string(), bytes);
        Ok(())
    }
    async fn copy_part(
        &self,
        target: &PartTarget<'_>,
        number: u32,
        from: &ObjectRef<'_>,
        range: Range<u64>,
    ) -> Result<String, AppError> {
        self.enter("copy_part").await?;
        let bytes = self
            .object(from.key)
            .ok_or_else(|| AppError::Provider("NoSuchKey".into()))?;
        let slice = bytes
            .get(range.start as usize..range.end as usize)
            .ok_or_else(|| AppError::Provider("InvalidRange".into()))?
            .to_vec();
        self.store_part(target, number, slice)
    }
    async fn put_part_bytes(
        &self,
        target: &PartTarget<'_>,
        number: u32,
        bytes: bytes::Bytes,
        progress: ProgressFn,
    ) -> Result<String, AppError> {
        self.enter("put_part_bytes").await?;
        progress(bytes.len() as u64);
        self.store_part(target, number, bytes.to_vec())
    }
    async fn put_bytes(
        &self,
        _: &str,
        key: &str,
        bytes: bytes::Bytes,
        progress: ProgressFn,
    ) -> Result<(), AppError> {
        self.enter("put_bytes").await?;
        progress(bytes.len() as u64);
        lock(&self.objects).insert(key.to_string(), bytes.to_vec());
        Ok(())
    }
    async fn get_bytes(
        &self,
        _: &str,
        key: &str,
        etag: &str,
        range: Range<u64>,
    ) -> Result<bytes::Bytes, AppError> {
        self.enter("get_bytes").await?;
        if self.etag(key) != etag {
            return Err(AppError::ObjectChanged);
        }
        let bytes = self
            .object(key)
            .ok_or_else(|| AppError::Provider("NoSuchKey".into()))?;
        let slice = bytes
            .get(range.start as usize..range.end as usize)
            .ok_or_else(|| AppError::Provider("InvalidRange".into()))?;
        Ok(bytes::Bytes::copy_from_slice(slice))
    }
    async fn get_range(
        &self,
        _: &str,
        key: &str,
        etag: &str,
        range: Range<u64>,
        path: &Path,
        progress: ProgressFn,
    ) -> Result<(), AppError> {
        self.enter("get_range").await?;
        if self.etag(key) != etag {
            return Err(AppError::ObjectChanged);
        }
        let bytes = self
            .object(key)
            .ok_or_else(|| AppError::Provider("NoSuchKey".into()))?;
        let slice = bytes
            .get(range.start as usize..range.end as usize)
            .ok_or_else(|| AppError::Provider("InvalidRange".into()))?;
        let mut file = std::fs::OpenOptions::new().write(true).open(path)?;
        file.seek(SeekFrom::Start(range.start))?;
        file.write_all(slice)?;
        progress(slice.len() as u64);
        Ok(())
    }
}

fn meta(key: &str, size: u64) -> ObjectMeta {
    ObjectMeta {
        key: key.to_string(),
        size,
        last_modified: None,
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
            etags: Mutex::new(HashMap::new()),
            uploads: Mutex::new(HashMap::new()),
            page_size: 1000,
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

    pub fn with_page_size(mut self, page_size: usize) -> Self {
        self.page_size = page_size;
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

    fn store_part(
        &self,
        target: &PartTarget<'_>,
        number: u32,
        bytes: Vec<u8>,
    ) -> Result<String, AppError> {
        let mut uploads = lock(&self.uploads);
        let (_, parts) = uploads
            .get_mut(target.upload_id)
            .ok_or(AppError::UploadGone)?;
        parts.insert(number, bytes);
        Ok(format!("\"p{number}\""))
    }

    pub fn set_etag(&self, key: &str, etag: &str) {
        lock(&self.etags).insert(key.to_string(), etag.to_string());
    }

    pub fn open_uploads(&self) -> usize {
        lock(&self.uploads).len()
    }

    fn etag(&self, key: &str) -> String {
        lock(&self.etags)
            .get(key)
            .cloned()
            .unwrap_or_else(|| "\"v1\"".to_string())
    }

    pub fn hold(&self) {
        self.held.send_replace(true);
    }

    pub fn release(&self) {
        self.held.send_replace(false);
    }

    async fn enter(&self, name: &'static str) -> Result<(), AppError> {
        *lock(&self.calls).entry(name).or_insert(0) += 1;
        if name != "abort_multipart" {
            let mut held = self.held.subscribe();
            held.wait_for(|held| !*held)
                .await
                .map_err(|_| AppError::Network)?;
        }
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
        let page = provider.list_keys("b", "2026/", None).await.unwrap();
        let found: Vec<(&str, u64)> = page
            .objects
            .iter()
            .map(|object| (object.key.as_str(), object.size))
            .collect();
        assert_eq!(found, vec![("2026/a.txt", 5)]);
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

    fn part_file(bytes: &[u8]) -> std::path::PathBuf {
        temp_file(bytes)
    }

    #[tokio::test]
    async fn multipart_parts_join_in_number_order() {
        let provider = fake();
        let source = part_file(b"aaabbbcc");
        let upload_id = provider.start_multipart("b", "big.bin").await.unwrap();
        let target = PartTarget {
            bucket: "b",
            key: "big.bin",
            upload_id: &upload_id,
        };
        let mut parts = Vec::new();
        for (number, offset, len) in [(3, 6, 2), (1, 0, 3), (2, 3, 3)] {
            let etag = provider
                .put_part(&target, number, &source, offset, len, no_progress())
                .await
                .unwrap();
            parts.push(CompletedPart { number, etag });
        }
        provider.complete_multipart(&target, &parts).await.unwrap();
        assert_eq!(provider.object("big.bin"), Some(b"aaabbbcc".to_vec()));
        assert_eq!(provider.calls("put_part"), 3);
    }

    #[tokio::test]
    async fn an_aborted_upload_is_gone() {
        let provider = fake();
        let upload_id = provider.start_multipart("b", "big.bin").await.unwrap();
        let target = PartTarget {
            bucket: "b",
            key: "big.bin",
            upload_id: &upload_id,
        };
        provider.abort_multipart(&target).await.unwrap();
        let sent = provider
            .put_part(&target, 1, &part_file(b"x"), 0, 1, no_progress())
            .await;
        assert_eq!(sent, Err(AppError::UploadGone));
    }

    #[tokio::test]
    async fn ranges_land_at_their_offset_and_check_the_etag() {
        let provider = fake().with_objects(vec![("a.bin", b"0123456789".to_vec())]);
        let info = provider.head("b", "a.bin").await.unwrap();
        assert_eq!(info.size, 10);
        let part = temp_file(&[0; 10]);
        provider
            .get_range("b", "a.bin", &info.etag, 5..10, &part, no_progress())
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(&part).unwrap(),
            [0, 0, 0, 0, 0, b'5', b'6', b'7', b'8', b'9']
        );
        provider.set_etag("a.bin", "\"changed\"");
        let stale = provider
            .get_range("b", "a.bin", &info.etag, 0..5, &part, no_progress())
            .await;
        assert_eq!(stale, Err(AppError::ObjectChanged));
    }

    #[tokio::test]
    async fn server_side_copies_and_part_copies_land_at_the_destination() {
        let provider = fake().with_objects(vec![("a.bin", b"0123456789".to_vec())]);
        let from = ObjectRef {
            bucket: "b",
            key: "a.bin",
        };
        provider
            .copy_object(
                &from,
                &ObjectRef {
                    bucket: "b",
                    key: "copy.bin",
                },
            )
            .await
            .unwrap();
        assert_eq!(provider.object("copy.bin"), Some(b"0123456789".to_vec()));
        let upload_id = provider.start_multipart("b", "big.bin").await.unwrap();
        let target = PartTarget {
            bucket: "b",
            key: "big.bin",
            upload_id: &upload_id,
        };
        let first = provider.copy_part(&target, 1, &from, 0..4).await.unwrap();
        let second = provider.copy_part(&target, 2, &from, 4..10).await.unwrap();
        provider
            .complete_multipart(
                &target,
                &[
                    CompletedPart {
                        number: 1,
                        etag: first,
                    },
                    CompletedPart {
                        number: 2,
                        etag: second,
                    },
                ],
            )
            .await
            .unwrap();
        assert_eq!(provider.object("big.bin"), Some(b"0123456789".to_vec()));
    }

    #[tokio::test]
    async fn bytes_can_be_put_whole_or_as_parts() {
        let provider = fake();
        provider
            .put_bytes(
                "b",
                "small.txt",
                bytes::Bytes::from_static(b"hi"),
                no_progress(),
            )
            .await
            .unwrap();
        assert_eq!(provider.object("small.txt"), Some(b"hi".to_vec()));
        let upload_id = provider.start_multipart("b", "two.bin").await.unwrap();
        let target = PartTarget {
            bucket: "b",
            key: "two.bin",
            upload_id: &upload_id,
        };
        let etag = provider
            .put_part_bytes(&target, 1, bytes::Bytes::from_static(b"xy"), no_progress())
            .await
            .unwrap();
        provider
            .complete_multipart(&target, &[CompletedPart { number: 1, etag }])
            .await
            .unwrap();
        assert_eq!(provider.object("two.bin"), Some(b"xy".to_vec()));
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

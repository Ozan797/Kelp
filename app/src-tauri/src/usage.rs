use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::error::AppError;
use crate::providers::StorageProvider;
use crate::transfers::manager::now_ms;
use crate::transfers::paths::Throttle;
use crate::transfers::retry::{backoff, is_retryable, jitter};

const MAX_ATTEMPTS: u32 = 5;
const PROGRESS_EVERY: Duration = Duration::from_millis(500);
const SAVE_EVERY: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageResult {
    pub connection_id: Uuid,
    pub bucket: String,
    pub prefix: String,
    pub bytes: u64,
    pub objects: u64,
    pub counted_at_ms: u64,
    pub complete: bool,
    pub resume_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageView {
    #[serde(flatten)]
    pub result: UsageResult,
    pub counting: bool,
    pub error: Option<String>,
}

pub type EmitUsage = Arc<dyn Fn(UsageView) + Send + Sync>;

fn usage_key(connection_id: Uuid, bucket: &str, prefix: &str) -> String {
    format!("{connection_id}/{bucket}/{prefix}")
}

impl UsageResult {
    pub fn new(connection_id: Uuid, bucket: &str, prefix: &str) -> Self {
        Self {
            connection_id,
            bucket: bucket.to_string(),
            prefix: prefix.to_string(),
            bytes: 0,
            objects: 0,
            counted_at_ms: 0,
            complete: false,
            resume_token: None,
        }
    }

    pub fn key(&self) -> String {
        usage_key(self.connection_id, &self.bucket, &self.prefix)
    }
}

pub async fn count(
    provider: &dyn StorageProvider,
    start: UsageResult,
    mut on_page: impl FnMut(&UsageResult),
) -> Result<UsageResult, AppError> {
    let mut result = if start.complete {
        UsageResult::new(start.connection_id, &start.bucket, &start.prefix)
    } else {
        start
    };
    loop {
        let page = page_with_retries(provider, &result).await?;
        result.bytes += page.objects.iter().map(|object| object.size).sum::<u64>();
        result.objects += page.objects.len() as u64;
        result.resume_token = page.next_token;
        result.complete = result.resume_token.is_none();
        result.counted_at_ms = now_ms();
        on_page(&result);
        if result.complete {
            return Ok(result);
        }
    }
}

async fn page_with_retries(
    provider: &dyn StorageProvider,
    result: &UsageResult,
) -> Result<crate::providers::KeyPage, AppError> {
    let mut tries = 1;
    loop {
        let page = provider
            .list_keys(&result.bucket, &result.prefix, result.resume_token.clone())
            .await;
        match page {
            Err(error) if is_retryable(&error) && tries < MAX_ATTEMPTS => {
                tokio::time::sleep(backoff(tries, jitter())).await;
                tries += 1;
            }
            other => return other,
        }
    }
}

pub struct UsageStore {
    path: PathBuf,
}

impl UsageStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("usage.json"),
        }
    }

    pub fn load(&self) -> HashMap<String, UsageResult> {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, results: &HashMap<String, UsageResult>) -> Result<(), AppError> {
        crate::json_file::write(&self.path, results)
    }
}

pub struct UsageCounts {
    store: UsageStore,
    results: Mutex<HashMap<String, UsageResult>>,
    errors: Mutex<HashMap<String, String>>,
    tasks: Mutex<HashMap<String, JoinHandle<()>>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl UsageCounts {
    pub fn new(store: UsageStore) -> Arc<Self> {
        Arc::new(Self {
            results: Mutex::new(store.load()),
            store,
            errors: Mutex::new(HashMap::new()),
            tasks: Mutex::new(HashMap::new()),
        })
    }

    pub fn get(&self, connection_id: Uuid, bucket: &str, prefix: &str) -> Option<UsageView> {
        let key = usage_key(connection_id, bucket, prefix);
        let result = lock(&self.results).get(&key).cloned()?;
        let counting = lock(&self.tasks)
            .get(&key)
            .is_some_and(|task| !task.is_finished());
        let error = lock(&self.errors).get(&key).cloned();
        Some(UsageView {
            result,
            counting,
            error,
        })
    }

    pub fn start(
        self: &Arc<Self>,
        provider: Arc<dyn StorageProvider>,
        connection_id: Uuid,
        bucket: &str,
        prefix: &str,
        emit: EmitUsage,
    ) -> bool {
        let key = usage_key(connection_id, bucket, prefix);
        let mut tasks = lock(&self.tasks);
        if tasks.get(&key).is_some_and(|task| !task.is_finished()) {
            return false;
        }
        lock(&self.errors).remove(&key);
        let start = lock(&self.results)
            .entry(key.clone())
            .or_insert_with(|| UsageResult::new(connection_id, bucket, prefix))
            .clone();
        let counts = self.clone();
        let task = tokio::spawn(async move {
            let mut progress = Throttle::new(PROGRESS_EVERY);
            let mut saving = Throttle::new(SAVE_EVERY);
            let counted = count(provider.as_ref(), start, |result| {
                lock(&counts.results).insert(result.key(), result.clone());
                if progress.ready(Instant::now(), result.complete) {
                    emit(UsageView {
                        result: result.clone(),
                        counting: !result.complete,
                        error: None,
                    });
                }
                if saving.ready(Instant::now(), result.complete) {
                    counts.save();
                }
            })
            .await;
            counts.save();
            if let Err(error) = counted {
                lock(&counts.errors).insert(key.clone(), error.to_string());
                if let Some(result) = lock(&counts.results).get(&key).cloned() {
                    emit(UsageView {
                        result,
                        counting: false,
                        error: Some(error.to_string()),
                    });
                }
            }
        });
        tasks.insert(usage_key(connection_id, bucket, prefix), task);
        true
    }

    pub async fn cancel(
        &self,
        connection_id: Uuid,
        bucket: &str,
        prefix: &str,
    ) -> Option<UsageView> {
        let key = usage_key(connection_id, bucket, prefix);
        let task = lock(&self.tasks).remove(&key);
        if let Some(task) = task {
            task.abort();
            task.await.ok();
        }
        self.save();
        self.get(connection_id, bucket, prefix)
    }

    fn save(&self) {
        let results = lock(&self.results).clone();
        self.store.save(&results).ok();
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use uuid::Uuid;

    use super::*;
    use crate::testing::FakeProvider;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("kelp-usage-{}", Uuid::new_v4()))
    }

    fn five_objects() -> FakeProvider {
        FakeProvider::empty()
            .with_objects(vec![
                ("2026/a", vec![0; 10]),
                ("2026/b", vec![0; 20]),
                ("2026/c", vec![0; 30]),
                ("2026/d", vec![0; 40]),
                ("2026/e", vec![0; 50]),
                ("other/f", vec![0; 99]),
            ])
            .with_page_size(2)
    }

    #[tokio::test]
    async fn counting_adds_up_every_page() {
        let provider = five_objects();
        let mut pages = 0;
        let result = count(
            &provider,
            UsageResult::new(Uuid::nil(), "media", "2026/"),
            |_| pages += 1,
        )
        .await
        .unwrap();
        assert_eq!((result.bytes, result.objects), (150, 5));
        assert!(result.complete);
        assert_eq!(result.resume_token, None);
        assert_eq!(pages, 3);
    }

    #[tokio::test]
    async fn an_interrupted_count_continues_from_its_token() {
        let provider = five_objects();
        let partial = UsageResult {
            bytes: 30,
            objects: 2,
            resume_token: Some("2".into()),
            ..UsageResult::new(Uuid::nil(), "media", "2026/")
        };
        let result = count(&provider, partial, |_| {}).await.unwrap();
        assert_eq!((result.bytes, result.objects), (150, 5));
    }

    #[tokio::test]
    async fn a_finished_count_starts_again_from_zero() {
        let provider = five_objects();
        let old = UsageResult {
            bytes: 999,
            objects: 9,
            complete: true,
            ..UsageResult::new(Uuid::nil(), "media", "2026/")
        };
        let result = count(&provider, old, |_| {}).await.unwrap();
        assert_eq!((result.bytes, result.objects), (150, 5));
    }

    #[test]
    fn results_are_saved_and_loaded() {
        let store = UsageStore::new(&temp_dir());
        let mut results = HashMap::new();
        let result = UsageResult {
            bytes: 5,
            ..UsageResult::new(Uuid::nil(), "media", "2026/")
        };
        results.insert(result.key(), result.clone());
        store.save(&results).unwrap();
        assert_eq!(store.load().get(&result.key()), Some(&result));
    }

    #[tokio::test]
    async fn a_count_that_fails_says_why_and_a_new_count_clears_it() {
        let provider = Arc::new(five_objects());
        provider.fail_next(1, AppError::AccessDenied);
        let counts = UsageCounts::new(UsageStore::new(&temp_dir()));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let captured = seen.clone();
        let emit: EmitUsage = Arc::new(move |view| captured.lock().unwrap().push(view));
        let id = Uuid::new_v4();
        counts.start(provider.clone(), id, "media", "2026/", emit.clone());
        for _ in 0..200 {
            if !seen.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let failed = counts.get(id, "media", "2026/").unwrap();
        assert_eq!(failed.error, Some(AppError::AccessDenied.to_string()));
        assert_eq!(seen.lock().unwrap()[0].error, failed.error);
        counts.start(provider, id, "media", "2026/", emit);
        assert_eq!(counts.get(id, "media", "2026/").unwrap().error, None);
    }

    #[tokio::test]
    async fn one_count_per_folder_and_cancelling_keeps_what_was_counted() {
        let provider = Arc::new(five_objects());
        provider.hold();
        let counts = UsageCounts::new(UsageStore::new(&temp_dir()));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let captured = seen.clone();
        let emit: EmitUsage = Arc::new(move |view| captured.lock().unwrap().push(view));
        let id = Uuid::new_v4();
        assert!(counts.start(provider.clone(), id, "media", "2026/", emit.clone()));
        assert!(!counts.start(provider.clone(), id, "media", "2026/", emit.clone()));
        assert!(counts.get(id, "media", "2026/").unwrap().counting);
        counts.cancel(id, "media", "2026/").await;
        let after = counts.get(id, "media", "2026/").unwrap();
        assert!(!after.counting && !after.result.complete);
        provider.release();
        assert!(counts.start(provider.clone(), id, "media", "2026/", emit));
        for _ in 0..200 {
            if counts
                .get(id, "media", "2026/")
                .is_some_and(|view| view.result.complete)
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("count never finished");
    }
}

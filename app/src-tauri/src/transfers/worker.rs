use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use uuid::Uuid;

use super::manager::TransferManager;
use super::model::{Direction, Item, ItemState, Transfer};
use super::paths::{finish_download, part_path};
use super::retry::{backoff, is_retryable, jitter};
use crate::error::AppError;
use crate::providers::{ProgressFn, StorageProvider};

const REQUESTS_PER_TRANSFER: usize = 4;
const MAX_ATTEMPTS: u32 = 5;
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

type Meters = Arc<Mutex<HashMap<usize, u64>>>;

struct Job {
    manager: Arc<TransferManager>,
    provider: Arc<dyn StorageProvider>,
    meters: Meters,
    id: Uuid,
    index: usize,
    direction: Direction,
    bucket: String,
    item: Item,
}

pub async fn run(manager: Arc<TransferManager>, transfer: Transfer) {
    match (manager.provider_for)(transfer.connection_id).await {
        Ok(provider) => run_items(&manager, &transfer, provider).await,
        Err(error) => {
            for index in pending(&transfer) {
                manager.item_failed(transfer.id, index, &error).await;
            }
        }
    }
    manager.worker_finished(transfer.id).await;
}

pub async fn clean_up(transfer: &Transfer, _provider: Option<Arc<dyn StorageProvider>>) {
    if transfer.direction == Direction::Download {
        for item in &transfer.items {
            if item.state != ItemState::Done {
                std::fs::remove_file(part_path(&item.local)).ok();
            }
        }
    }
}

fn pending(transfer: &Transfer) -> Vec<usize> {
    transfer
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| item.state == ItemState::Pending)
        .map(|(index, _)| index)
        .collect()
}

async fn run_items(
    manager: &Arc<TransferManager>,
    transfer: &Transfer,
    provider: Arc<dyn StorageProvider>,
) {
    let meters: Meters = Arc::default();
    let slots = Arc::new(Semaphore::new(REQUESTS_PER_TRANSFER));
    let mut jobs = JoinSet::new();
    for index in pending(transfer) {
        let job = Job {
            manager: manager.clone(),
            provider: provider.clone(),
            meters: meters.clone(),
            id: transfer.id,
            index,
            direction: transfer.direction,
            bucket: transfer.bucket.clone(),
            item: transfer.items[index].clone(),
        };
        let slots = slots.clone();
        jobs.spawn(async move {
            let _slot = slots.acquire_owned().await;
            job.run().await;
        });
    }
    let mut ticker = tokio::time::interval(PROGRESS_EVERY);
    loop {
        tokio::select! {
            joined = jobs.join_next() => if joined.is_none() { break },
            _ = ticker.tick() => {
                let snapshot = read(&meters).clone();
                manager.progress(transfer.id, snapshot).await;
            }
        }
    }
}

fn read(meters: &Meters) -> std::sync::MutexGuard<'_, HashMap<usize, u64>> {
    meters
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Job {
    async fn run(self) {
        let outcome = match self.direction {
            Direction::Upload => self.upload().await.map(|()| None),
            Direction::Download => self.download().await.map(Some),
        };
        read(&self.meters).remove(&self.index);
        match outcome {
            Ok(saved_as) => self.manager.item_done(self.id, self.index, saved_as).await,
            Err(error) => self.manager.item_failed(self.id, self.index, &error).await,
        }
    }

    fn meter(&self) -> ProgressFn {
        let meters = self.meters.clone();
        let index = self.index;
        Arc::new(move |bytes| {
            read(&meters).insert(index, bytes);
        })
    }

    async fn upload(&self) -> Result<(), AppError> {
        self.with_retries(|| {
            self.provider
                .put_file(&self.bucket, &self.item.key, &self.item.local, self.meter())
        })
        .await
    }

    async fn download(&self) -> Result<PathBuf, AppError> {
        let part = part_path(&self.item.local);
        let fetched = self
            .with_retries(|| async {
                let info = self.provider.head(&self.bucket, &self.item.key).await?;
                std::fs::OpenOptions::new()
                    .create(true)
                    .truncate(true)
                    .write(true)
                    .open(&part)?
                    .set_len(info.size)?;
                if info.size == 0 {
                    return Ok(());
                }
                self.provider
                    .get_range(
                        &self.bucket,
                        &self.item.key,
                        &info.etag,
                        0..info.size,
                        &part,
                        self.meter(),
                    )
                    .await
            })
            .await;
        if let Err(error) = fetched {
            std::fs::remove_file(&part).ok();
            return Err(error);
        }
        let dir = self.item.local.parent().unwrap_or(Path::new("."));
        let name = self
            .item
            .local
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "download".to_string());
        Ok(finish_download(dir, &name, &part, self.item.local.clone())?)
    }

    async fn with_retries<T, F, Fut>(&self, mut attempt: F) -> Result<T, AppError>
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Result<T, AppError>>,
    {
        let mut tries = 1;
        loop {
            read(&self.meters).insert(self.index, 0);
            let permit = self.manager.requests.acquire().await;
            let result = attempt().await;
            drop(permit);
            match result {
                Err(error) if is_retryable(&error) && tries < MAX_ATTEMPTS => {
                    let wait = backoff(tries, jitter());
                    self.manager.retrying(self.id, wait).await;
                    tokio::time::sleep(wait).await;
                    self.manager.running(self.id).await;
                    tries += 1;
                }
                other => return other,
            }
        }
    }
}

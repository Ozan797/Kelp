use std::collections::HashMap;
use std::future::Future;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use uuid::Uuid;

use super::manager::TransferManager;
use super::model::{CompletedPart, Direction, Item, ItemState, Resume, Transfer};
use super::paths::{finish_download, part_path};
use super::plan::{COPY_PART_SIZE, MAX_SIMPLE_COPY, PART_SIZE, part_size, ranges, uses_multipart};
use super::retry::{backoff, is_retryable, jitter};
use crate::error::AppError;
use crate::providers::{ObjectRef, PartTarget, ProgressFn, StorageProvider};

const REQUESTS_PER_TRANSFER: usize = 4;
const MAX_ATTEMPTS: u32 = 5;
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

type Meters = Arc<Mutex<HashMap<(usize, u32), u64>>>;

struct Job {
    manager: Arc<TransferManager>,
    provider: Arc<dyn StorageProvider>,
    meters: Meters,
    slots: Arc<Semaphore>,
    id: Uuid,
    run: u64,
    index: usize,
    direction: Direction,
    bucket: String,
    item: Item,
    source: Option<CopySource>,
}

#[derive(Clone)]
struct CopySource {
    provider: Arc<dyn StorageProvider>,
    bucket: String,
    same: bool,
    move_after: bool,
}

type PartFuture = Pin<Box<dyn Future<Output = Result<String, AppError>> + Send>>;
type SendPart = Arc<dyn Fn(Arc<Job>, String, u32, Range<u64>) -> PartFuture + Send + Sync>;

pub async fn run(manager: Arc<TransferManager>, transfer: Transfer, run: u64) {
    let source = match &transfer.source {
        Some(source) => match (manager.provider_for)(source.connection_id).await {
            Ok(provider) => Ok(Some(CopySource {
                provider,
                bucket: source.bucket.clone(),
                same: source.connection_id == transfer.connection_id,
                move_after: source.move_after,
            })),
            Err(error) => Err(error),
        },
        None => Ok(None),
    };
    let destination = (manager.provider_for)(transfer.connection_id).await;
    match destination.and_then(|provider| source.map(|source| (provider, source))) {
        Ok((provider, source)) => run_items(&manager, &transfer, provider, source, run).await,
        Err(error) => {
            for index in pending(&transfer) {
                manager.item_failed(transfer.id, index, &error, run).await;
            }
        }
    }
    manager.worker_finished(transfer.id, run).await;
}

pub async fn clean_up(transfer: &Transfer, provider: Option<Arc<dyn StorageProvider>>) {
    for item in &transfer.items {
        if item.state == ItemState::Done {
            continue;
        }
        match (&item.resume, &provider) {
            (Some(Resume::Upload { upload_id, .. }), Some(provider)) => {
                let target = PartTarget {
                    bucket: &transfer.bucket,
                    key: &item.key,
                    upload_id,
                };
                provider.abort_multipart(&target).await.ok();
            }
            _ if transfer.direction == Direction::Download => {
                std::fs::remove_file(part_path(&item.local)).ok();
            }
            _ => {}
        }
    }
}

pub fn stamp(etag: &str) -> u64 {
    etag.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

pub fn modified_ms(path: &Path) -> Result<u64, AppError> {
    let modified = std::fs::metadata(path)?.modified()?;
    Ok(modified
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0))
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

fn read(meters: &Meters) -> std::sync::MutexGuard<'_, HashMap<(usize, u32), u64>> {
    meters
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn per_item(meters: &Meters) -> HashMap<usize, u64> {
    let mut totals = HashMap::new();
    for ((index, _), bytes) in read(meters).iter() {
        *totals.entry(*index).or_insert(0) += bytes;
    }
    totals
}

async fn run_items(
    manager: &Arc<TransferManager>,
    transfer: &Transfer,
    provider: Arc<dyn StorageProvider>,
    source: Option<CopySource>,
    run: u64,
) {
    let meters: Meters = Arc::default();
    let slots = Arc::new(Semaphore::new(REQUESTS_PER_TRANSFER));
    let mut jobs = JoinSet::new();
    for index in pending(transfer) {
        let job = Arc::new(Job {
            manager: manager.clone(),
            provider: provider.clone(),
            meters: meters.clone(),
            slots: slots.clone(),
            id: transfer.id,
            run,
            index,
            direction: transfer.direction,
            bucket: transfer.bucket.clone(),
            item: transfer.items[index].clone(),
            source: source.clone(),
        });
        jobs.spawn(job.run());
    }
    let mut ticker = tokio::time::interval(PROGRESS_EVERY);
    loop {
        tokio::select! {
            joined = jobs.join_next() => if joined.is_none() { break },
            _ = ticker.tick() => manager.progress(transfer.id, per_item(&meters), run).await,
        }
    }
}

impl Job {
    async fn run(self: Arc<Self>) {
        let outcome = match self.direction {
            Direction::Upload => self.clone().upload().await.map(|()| None),
            Direction::Download => self.clone().download().await.map(Some),
            Direction::Copy => self.clone().copy().await.map(|()| None),
        };
        read(&self.meters).retain(|(index, _), _| *index != self.index);
        match outcome {
            Ok(saved_as) => {
                self.manager
                    .item_done(self.id, self.index, saved_as, self.run)
                    .await
            }
            Err(error) => {
                self.manager
                    .item_failed(self.id, self.index, &error, self.run)
                    .await
            }
        }
    }

    fn meter(&self, part: u32) -> ProgressFn {
        let meters = self.meters.clone();
        let key = (self.index, part);
        Arc::new(move |bytes| {
            read(&meters).insert(key, bytes);
        })
    }

    async fn copy(self: Arc<Self>) -> Result<(), AppError> {
        let lost = || {
            AppError::Provider("This copy has lost its source. Remove it and copy again.".into())
        };
        let source = self.source.clone().ok_or_else(lost)?;
        let from_key = self.item.source_key.clone().ok_or_else(lost)?;
        let mut saved = self.item.resume.clone();
        for attempt in 0..2 {
            let copied = self
                .clone()
                .copy_once(&source, &from_key, saved.take())
                .await;
            match copied {
                Err(AppError::ObjectChanged) if attempt == 0 => {
                    self.manager
                        .set_resume(self.id, self.index, None, true, self.run)
                        .await;
                }
                other => {
                    other?;
                    break;
                }
            }
        }
        if source.move_after {
            let keys = [from_key.clone()];
            self.with_retries(0, || source.provider.delete(&source.bucket, &keys))
                .await?;
        }
        Ok(())
    }

    async fn copy_once(
        self: Arc<Self>,
        source: &CopySource,
        from_key: &str,
        saved: Option<Resume>,
    ) -> Result<(), AppError> {
        let info = self
            .with_retries(0, || source.provider.head(&source.bucket, from_key))
            .await?;
        self.manager
            .set_size(self.id, self.index, info.size, self.run)
            .await;
        let fingerprint = stamp(&info.etag);
        let (bucket, key) = (source.bucket.clone(), from_key.to_string());
        if source.same {
            if info.size <= MAX_SIMPLE_COPY {
                let from = ObjectRef {
                    bucket: &bucket,
                    key: &key,
                };
                let to = ObjectRef {
                    bucket: &self.bucket,
                    key: &self.item.key,
                };
                return self
                    .with_retries(0, || self.provider.copy_object(&from, &to))
                    .await;
            }
            let send: SendPart = Arc::new(move |job, upload_id, number, range| {
                let (bucket, key) = (bucket.clone(), key.clone());
                Box::pin(async move {
                    let from = ObjectRef {
                        bucket: &bucket,
                        key: &key,
                    };
                    job.provider
                        .copy_part(&job.target(&upload_id), number, &from, range)
                        .await
                })
            });
            let part = COPY_PART_SIZE.max(part_size(info.size));
            return self
                .in_parts(saved, info.size, fingerprint, part, send)
                .await;
        }
        let from = source.provider.clone();
        if !uses_multipart(info.size) {
            let etag = info.etag.clone();
            return self
                .with_retries(0, || async {
                    let bytes = if info.size == 0 {
                        bytes::Bytes::new()
                    } else {
                        from.get_bytes(&bucket, &key, &etag, 0..info.size).await?
                    };
                    self.provider
                        .put_bytes(&self.bucket, &self.item.key, bytes, self.meter(0))
                        .await
                })
                .await;
        }
        let etag = info.etag.clone();
        let send: SendPart = Arc::new(move |job, upload_id, number, range| {
            let (from, bucket, key, etag) =
                (from.clone(), bucket.clone(), key.clone(), etag.clone());
            Box::pin(async move {
                let bytes = from.get_bytes(&bucket, &key, &etag, range).await?;
                job.provider
                    .put_part_bytes(&job.target(&upload_id), number, bytes, job.meter(number))
                    .await
            })
        });
        self.in_parts(saved, info.size, fingerprint, part_size(info.size), send)
            .await
    }

    async fn upload(self: Arc<Self>) -> Result<(), AppError> {
        if !uses_multipart(self.item.size) {
            return self
                .with_retries(0, || {
                    self.provider.put_file(
                        &self.bucket,
                        &self.item.key,
                        &self.item.local,
                        self.meter(0),
                    )
                })
                .await;
        }
        let size = std::fs::metadata(&self.item.local)?.len();
        let fingerprint = modified_ms(&self.item.local)?;
        let send: SendPart = Arc::new(|job, upload_id, number, range| {
            Box::pin(async move {
                job.provider
                    .put_part(
                        &job.target(&upload_id),
                        number,
                        &job.item.local,
                        range.start,
                        range.end - range.start,
                        job.meter(number),
                    )
                    .await
            })
        });
        let saved = self.item.resume.clone();
        self.in_parts(saved, size, fingerprint, part_size(size), send)
            .await
    }

    async fn in_parts(
        self: Arc<Self>,
        saved: Option<Resume>,
        size: u64,
        fingerprint: u64,
        part: u64,
        send: SendPart,
    ) -> Result<(), AppError> {
        let mut resume = saved;
        for _ in 0..2 {
            let sent = self
                .clone()
                .multipart(resume.take(), size, fingerprint, part, send.clone())
                .await;
            match sent {
                Err(AppError::UploadGone) => {
                    self.manager
                        .set_resume(self.id, self.index, None, true, self.run)
                        .await;
                }
                other => return other,
            }
        }
        Err(AppError::UploadGone)
    }

    async fn multipart(
        self: Arc<Self>,
        saved: Option<Resume>,
        local_size: u64,
        local_modified_ms: u64,
        part: u64,
        send: SendPart,
    ) -> Result<(), AppError> {
        let (upload_id, size, done) = match saved {
            Some(Resume::Upload {
                upload_id,
                part_size,
                parts,
                local_size: saved_size,
                local_modified_ms: saved_modified,
            }) if saved_size == local_size && saved_modified == local_modified_ms => {
                (upload_id, part_size, parts)
            }
            other => {
                if let Some(Resume::Upload { upload_id, .. }) = other {
                    self.abort(&upload_id).await;
                }
                let started = self
                    .clone()
                    .start_and_save(part, local_size, local_modified_ms);
                let upload_id = tokio::spawn(started)
                    .await
                    .map_err(|_| AppError::UploadGone)??;
                (upload_id, part, Vec::new())
            }
        };
        let resume = {
            let upload_id = upload_id.clone();
            move |parts: Vec<CompletedPart>| Resume::Upload {
                upload_id: upload_id.clone(),
                part_size: size,
                parts,
                local_size,
                local_modified_ms,
            }
        };
        self.manager
            .set_resume(
                self.id,
                self.index,
                Some(resume(done.clone())),
                true,
                self.run,
            )
            .await;

        let plan = ranges(local_size, size);
        let finished: Vec<u32> = done.iter().map(|part| part.number).collect();
        let parts = Arc::new(Mutex::new(done));
        let mut sending = JoinSet::new();
        for (offset, range) in plan.into_iter().enumerate() {
            let number = offset as u32 + 1;
            if finished.contains(&number) {
                continue;
            }
            let job = self.clone();
            let parts = parts.clone();
            let upload_id = upload_id.clone();
            let resume = resume.clone();
            let send = send.clone();
            sending.spawn(async move {
                let etag = job
                    .with_retries(number, || {
                        send(job.clone(), upload_id.clone(), number, range.clone())
                    })
                    .await?;
                read(&job.meters).remove(&(job.index, number));
                let snapshot = {
                    let mut parts = parts.lock().unwrap_or_else(|p| p.into_inner());
                    parts.push(CompletedPart { number, etag });
                    parts.clone()
                };
                job.manager
                    .set_resume(job.id, job.index, Some(resume(snapshot)), false, job.run)
                    .await;
                Ok::<(), AppError>(())
            });
        }
        while let Some(sent) = sending.join_next().await {
            sent.map_err(|_| AppError::Network)??;
        }
        let parts = parts.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let target = self.target(&upload_id);
        self.with_retries(0, || self.provider.complete_multipart(&target, &parts))
            .await
    }

    async fn start_and_save(
        self: Arc<Self>,
        part_size: u64,
        local_size: u64,
        local_modified_ms: u64,
    ) -> Result<String, AppError> {
        let upload_id = self
            .with_retries(0, || {
                self.provider.start_multipart(&self.bucket, &self.item.key)
            })
            .await?;
        let resume = Resume::Upload {
            upload_id: upload_id.clone(),
            part_size,
            parts: Vec::new(),
            local_size,
            local_modified_ms,
        };
        let kept = self
            .manager
            .set_resume(self.id, self.index, Some(resume), true, self.run)
            .await;
        if kept {
            Ok(upload_id)
        } else {
            self.abort(&upload_id).await;
            Err(AppError::UploadGone)
        }
    }

    fn target<'a>(&'a self, upload_id: &'a str) -> PartTarget<'a> {
        PartTarget {
            bucket: &self.bucket,
            key: &self.item.key,
            upload_id,
        }
    }

    async fn abort(&self, upload_id: &str) {
        self.provider
            .abort_multipart(&self.target(upload_id))
            .await
            .ok();
    }

    async fn download(self: Arc<Self>) -> Result<PathBuf, AppError> {
        if self.item.key.ends_with('/') {
            std::fs::create_dir_all(&self.item.local)?;
            return Ok(self.item.local.clone());
        }
        if let Some(parent) = self.item.local.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let part = part_path(&self.item.local);
        let mut saved = self.item.resume.clone();
        let mut outcome = Err(AppError::ObjectChanged);
        for _ in 0..2 {
            outcome = self.clone().fetch(&part, saved.take()).await;
            if outcome != Err(AppError::ObjectChanged) {
                break;
            }
            self.manager
                .set_resume(self.id, self.index, None, true, self.run)
                .await;
        }
        outcome?;
        let dir = self.item.local.parent().unwrap_or(Path::new("."));
        let name = self
            .item
            .local
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "download".to_string());
        Ok(finish_download(dir, &name, &part, self.item.local.clone())?)
    }

    async fn fetch(self: Arc<Self>, part: &Path, saved: Option<Resume>) -> Result<(), AppError> {
        let info = self
            .with_retries(0, || self.provider.head(&self.bucket, &self.item.key))
            .await?;
        self.manager
            .set_size(self.id, self.index, info.size, self.run)
            .await;
        let done = match saved {
            Some(Resume::Download {
                etag, done_ranges, ..
            }) if etag == info.etag && part.exists() => done_ranges,
            _ => {
                std::fs::File::create(part)?.set_len(info.size)?;
                Vec::new()
            }
        };
        let resume = {
            let etag = info.etag.clone();
            let part_path = part.to_path_buf();
            move |done_ranges: Vec<u32>| Resume::Download {
                etag: etag.clone(),
                part_path: part_path.clone(),
                done_ranges,
            }
        };
        self.manager
            .set_resume(
                self.id,
                self.index,
                Some(resume(done.clone())),
                true,
                self.run,
            )
            .await;
        let plan = ranges(info.size, PART_SIZE);
        let fetched = Arc::new(Mutex::new(done.clone()));
        let mut fetching = JoinSet::new();
        for (index, range) in plan.into_iter().enumerate() {
            let index = index as u32;
            if done.contains(&index) {
                continue;
            }
            let job = self.clone();
            let fetched = fetched.clone();
            let resume = resume.clone();
            let etag = info.etag.clone();
            let part = part.to_path_buf();
            fetching.spawn(async move {
                job.with_retries(index + 1, || {
                    job.provider.get_range(
                        &job.bucket,
                        &job.item.key,
                        &etag,
                        range.clone(),
                        &part,
                        job.meter(index + 1),
                    )
                })
                .await?;
                read(&job.meters).remove(&(job.index, index + 1));
                let snapshot = {
                    let mut fetched = fetched.lock().unwrap_or_else(|p| p.into_inner());
                    fetched.push(index);
                    fetched.clone()
                };
                job.manager
                    .set_resume(job.id, job.index, Some(resume(snapshot)), false, job.run)
                    .await;
                Ok::<(), AppError>(())
            });
        }
        while let Some(got) = fetching.join_next().await {
            got.map_err(|_| AppError::Network)??;
        }
        Ok(())
    }

    async fn with_retries<T, F, Fut>(&self, part: u32, mut attempt: F) -> Result<T, AppError>
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Result<T, AppError>>,
    {
        let mut tries = 1;
        loop {
            read(&self.meters).insert((self.index, part), 0);
            let slot = self.slots.acquire().await;
            let permit = self.manager.requests.acquire().await;
            let result = attempt().await;
            drop(permit);
            drop(slot);
            match result {
                Err(error) if is_retryable(&error) && tries < MAX_ATTEMPTS => {
                    let wait = backoff(tries, jitter());
                    self.manager.retrying(self.id, wait, self.run).await;
                    tokio::time::sleep(wait).await;
                    self.manager.running(self.id, self.run).await;
                    tries += 1;
                }
                other => return other,
            }
        }
    }
}

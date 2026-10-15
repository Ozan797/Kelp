use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinHandle;
use uuid::Uuid;

use super::model::{ItemState, Kind, Resume, Status, Transfer, TransferProgress, TransferView};
use super::paths::Throttle;
use super::queue::Queue;
use super::store::TransferStore;
use super::worker;
use crate::error::AppError;
use crate::providers::StorageProvider;

pub const MAX_REQUESTS: usize = 16;

#[derive(Debug, Clone)]
pub enum Event {
    State(TransferView),
    Progress(TransferProgress),
}

pub type Emit = Arc<dyn Fn(Event) + Send + Sync>;
pub type ProviderFuture =
    Pin<Box<dyn Future<Output = Result<Arc<dyn StorageProvider>, AppError>> + Send>>;
pub type ProviderFor = Arc<dyn Fn(Uuid) -> ProviderFuture + Send + Sync>;

struct Inner {
    queue: Queue,
    tasks: HashMap<Uuid, JoinHandle<()>>,
    in_flight: HashMap<(Uuid, usize), u64>,
    reported: HashMap<Uuid, u64>,
    save_throttle: Throttle,
}

pub struct TransferManager {
    inner: Mutex<Inner>,
    pub(super) requests: Arc<Semaphore>,
    store: TransferStore,
    emit: Emit,
    pub(super) provider_for: ProviderFor,
}

impl Inner {
    fn done(&self, transfer: &Transfer) -> u64 {
        let in_flight: u64 = self
            .in_flight
            .iter()
            .filter(|((id, _), _)| *id == transfer.id)
            .map(|(_, bytes)| bytes)
            .sum();
        transfer.done_bytes() + in_flight
    }

    fn view(&self, id: Uuid) -> Option<TransferView> {
        let transfer = self.queue.get(id)?;
        Some(transfer.view(self.done(transfer)))
    }

    fn forget_progress(&mut self, id: Uuid) {
        self.in_flight.retain(|(transfer, _), _| *transfer != id);
        self.reported.remove(&id);
    }
}

impl TransferManager {
    pub fn new(store: TransferStore, emit: Emit, provider_for: ProviderFor) -> Arc<Self> {
        let mut queue = Queue::new(store.load());
        queue.restore_after_launch();
        Arc::new(Self {
            inner: Mutex::new(Inner {
                queue,
                tasks: HashMap::new(),
                in_flight: HashMap::new(),
                reported: HashMap::new(),
                save_throttle: Throttle::new(Duration::from_secs(1)),
            }),
            requests: Arc::new(Semaphore::new(MAX_REQUESTS)),
            store,
            emit,
            provider_for,
        })
    }

    pub async fn start(self: &Arc<Self>) {
        let mut inner = self.inner.lock().await;
        self.pump(&mut inner);
    }

    pub async fn add(self: &Arc<Self>, transfer: Transfer) -> Uuid {
        let id = transfer.id;
        let mut inner = self.inner.lock().await;
        inner.queue.add(transfer);
        self.changed(&mut inner, id);
        self.pump(&mut inner);
        id
    }

    pub async fn list(&self) -> Vec<TransferView> {
        let inner = self.inner.lock().await;
        inner
            .queue
            .all()
            .iter()
            .map(|transfer| transfer.view(inner.done(transfer)))
            .collect()
    }

    pub async fn pause(self: &Arc<Self>, id: Uuid) {
        let mut inner = self.inner.lock().await;
        if !inner.queue.pause(id) {
            return;
        }
        if let Some(task) = inner.tasks.remove(&id) {
            task.abort();
        }
        inner.forget_progress(id);
        self.changed(&mut inner, id);
        self.pump(&mut inner);
    }

    pub async fn resume(self: &Arc<Self>, id: Uuid) {
        let mut inner = self.inner.lock().await;
        if inner.queue.resume(id) {
            self.changed(&mut inner, id);
            self.pump(&mut inner);
        }
    }

    pub async fn retry(self: &Arc<Self>, id: Uuid) {
        let mut inner = self.inner.lock().await;
        if inner.queue.retry(id) {
            self.changed(&mut inner, id);
            self.pump(&mut inner);
        }
    }

    pub async fn pause_all(self: &Arc<Self>) {
        for id in self.ids().await {
            self.pause(id).await;
        }
    }

    pub async fn resume_all(self: &Arc<Self>) {
        for id in self.ids().await {
            self.resume(id).await;
        }
    }

    pub async fn cancel(self: &Arc<Self>, id: Uuid) {
        let (task, removed) = {
            let mut inner = self.inner.lock().await;
            let task = inner.tasks.remove(&id);
            let removed = inner.queue.remove(id);
            inner.forget_progress(id);
            (task, removed)
        };
        if let Some(task) = task {
            task.abort();
            task.await.ok();
        }
        let Some(mut transfer) = removed else {
            return;
        };
        let provider = (self.provider_for)(transfer.connection_id).await.ok();
        worker::clean_up(&transfer, provider).await;
        transfer.status = Status::Cancelled;
        (self.emit)(Event::State(transfer.view(0)));
        let mut inner = self.inner.lock().await;
        self.save(&mut inner);
        self.pump(&mut inner);
    }

    pub(super) async fn running(&self, id: Uuid) {
        let mut inner = self.inner.lock().await;
        if let Some(transfer) = inner.queue.get_mut(id)
            && matches!(transfer.status, Status::Retrying { .. })
        {
            transfer.status = Status::Running;
            self.notify(&inner, id);
        }
    }

    pub(super) async fn retrying(&self, id: Uuid, wait: Duration) {
        let mut inner = self.inner.lock().await;
        if let Some(transfer) = inner.queue.get_mut(id)
            && transfer.status.is_active()
        {
            transfer.status = Status::Retrying {
                at_ms: now_ms() + wait.as_millis() as u64,
            };
            self.notify(&inner, id);
        }
    }

    pub(super) async fn progress(&self, id: Uuid, in_flight: HashMap<usize, u64>) {
        let mut inner = self.inner.lock().await;
        inner.in_flight.retain(|(transfer, _), _| *transfer != id);
        inner.in_flight.extend(
            in_flight
                .into_iter()
                .map(|(index, bytes)| ((id, index), bytes)),
        );
        let Some(view) = inner.view(id) else {
            return;
        };
        if inner.reported.insert(id, view.done) != Some(view.done) {
            (self.emit)(Event::Progress(TransferProgress {
                id,
                done: view.done,
                total: view.total,
                files_done: view.files_done,
            }));
        }
    }

    pub(super) async fn set_resume(
        &self,
        id: Uuid,
        index: usize,
        resume: Option<Resume>,
        urgent: bool,
    ) {
        let mut inner = self.inner.lock().await;
        if let Some(item) = inner.queue.get_mut(id).and_then(|t| t.items.get_mut(index)) {
            item.resume = resume;
        }
        if urgent {
            self.save(&mut inner);
        } else {
            self.save_soon(&mut inner);
        }
    }

    pub(super) async fn set_size(&self, id: Uuid, index: usize, size: u64) {
        let mut inner = self.inner.lock().await;
        if let Some(item) = inner.queue.get_mut(id).and_then(|t| t.items.get_mut(index)) {
            item.size = size;
        }
    }

    pub(super) async fn item_done(&self, id: Uuid, index: usize, saved_as: Option<PathBuf>) {
        let mut inner = self.inner.lock().await;
        inner.in_flight.remove(&(id, index));
        if let Some(transfer) = inner.queue.get_mut(id) {
            let single = transfer.kind == Kind::File;
            if let Some(item) = transfer.items.get_mut(index) {
                item.state = ItemState::Done;
                item.resume = None;
                if let Some(path) = saved_as {
                    item.local = path.clone();
                    if single {
                        transfer.local_root = path;
                    }
                }
            }
        }
        self.save_soon(&mut inner);
    }

    pub(super) async fn item_failed(&self, id: Uuid, index: usize, error: &AppError) {
        let mut inner = self.inner.lock().await;
        inner.in_flight.remove(&(id, index));
        if let Some(item) = inner.queue.get_mut(id).and_then(|t| t.items.get_mut(index)) {
            item.state = ItemState::Failed {
                message: error.to_string(),
            };
        }
        self.save_soon(&mut inner);
    }

    pub(super) async fn worker_finished(self: &Arc<Self>, id: Uuid) {
        let mut inner = self.inner.lock().await;
        inner.tasks.remove(&id);
        let active = inner
            .queue
            .get(id)
            .is_some_and(|transfer| transfer.status.is_active());
        if !active {
            return;
        }
        inner.queue.finish(id);
        inner.forget_progress(id);
        self.changed(&mut inner, id);
        if inner.queue.get(id).map(|t| t.status) == Some(Status::Finished) {
            inner.queue.remove(id);
            self.save(&mut inner);
        }
        self.pump(&mut inner);
    }

    async fn ids(&self) -> Vec<Uuid> {
        let inner = self.inner.lock().await;
        inner
            .queue
            .all()
            .iter()
            .map(|transfer| transfer.id)
            .collect()
    }

    fn pump(self: &Arc<Self>, inner: &mut Inner) {
        for id in inner.queue.next_to_start(inner.tasks.len()) {
            let Some(transfer) = inner.queue.get_mut(id) else {
                continue;
            };
            transfer.status = Status::Running;
            let snapshot = transfer.clone();
            let manager = self.clone();
            let task = tokio::spawn(async move { worker::run(manager, snapshot).await });
            inner.tasks.insert(id, task);
            self.changed(inner, id);
        }
    }

    fn changed(&self, inner: &mut Inner, id: Uuid) {
        self.notify(inner, id);
        self.save(inner);
    }

    fn notify(&self, inner: &Inner, id: Uuid) {
        if let Some(view) = inner.view(id) {
            (self.emit)(Event::State(view));
        }
    }

    fn save(&self, inner: &mut Inner) {
        inner.save_throttle.ready(Instant::now(), true);
        self.store.save(inner.queue.all()).ok();
    }

    fn save_soon(&self, inner: &mut Inner) {
        if inner.save_throttle.ready(Instant::now(), false) {
            self.store.save(inner.queue.all()).ok();
        }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use uuid::Uuid;

    use super::*;
    use crate::error::AppError;
    use crate::providers::StorageProvider;
    use crate::providers::{CompletedPart, PartTarget};
    use crate::testing::FakeProvider;
    use crate::transfers::model::tests::{item, transfer};
    use crate::transfers::model::{Direction, ItemState, Kind, Resume, Status, Transfer};
    use crate::transfers::paths::part_path;
    use crate::transfers::store::TransferStore;
    use crate::transfers::worker;

    struct Harness {
        manager: Arc<TransferManager>,
        provider: Arc<FakeProvider>,
        events: Arc<Mutex<Vec<Event>>>,
        dir: PathBuf,
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kelp-manager-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn harness_in(dir: PathBuf, provider: Arc<FakeProvider>, connected: bool) -> Harness {
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        let shared = provider.clone();
        let provider_for: ProviderFor = Arc::new(move |_| {
            let shared = shared.clone();
            Box::pin(async move {
                if connected {
                    Ok(shared as Arc<dyn StorageProvider>)
                } else {
                    Err(AppError::ConnectionNotFound)
                }
            })
        });
        let manager = TransferManager::new(
            TransferStore::new(&dir),
            Arc::new(move |event| captured.lock().unwrap().push(event)),
            provider_for,
        );
        Harness {
            manager,
            provider,
            events,
            dir,
        }
    }

    fn harness() -> Harness {
        harness_in(temp_dir(), Arc::new(FakeProvider::empty()), true)
    }

    impl Harness {
        fn upload(&self, name: &str, bytes: &[u8]) -> Transfer {
            let path = self.dir.join(name);
            std::fs::write(&path, bytes).unwrap();
            let mut one = transfer(vec![item(&format!("2026/{name}"), bytes.len() as u64)]);
            one.items[0].local = path;
            one
        }

        fn statuses(&self, id: Uuid) -> Vec<&'static str> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .filter_map(|event| match event {
                    Event::State(view) if view.id == id => Some(view.status),
                    _ => None,
                })
                .collect()
        }

        async fn wait_for(&self, id: Uuid, status: &str) {
            for _ in 0..1000 {
                if self.statuses(id).contains(&status) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            panic!("{id} never became {status}; saw {:?}", self.statuses(id));
        }

        async fn current(&self, status: &str) -> usize {
            self.manager
                .list()
                .await
                .iter()
                .filter(|view| view.status == status)
                .count()
        }

        async fn settle(&self) {
            for _ in 0..20 {
                tokio::task::yield_now().await;
            }
        }
    }

    fn patterned(len: usize) -> Vec<u8> {
        (0..len).map(|n| (n % 251) as u8).collect()
    }

    const BIG: usize = 20 * 1024 * 1024;

    impl Harness {
        fn big_upload(&self) -> (Transfer, Vec<u8>) {
            let bytes = patterned(BIG);
            (self.upload("big.bin", &bytes), bytes)
        }

        async fn upload_with_first_part_sent(
            &self,
            fingerprint_matches: bool,
        ) -> (Transfer, Vec<u8>) {
            let (mut big, bytes) = self.big_upload();
            let upload_id = self
                .provider
                .start_multipart("media", "2026/big.bin")
                .await
                .unwrap();
            let target = PartTarget {
                bucket: "media",
                key: "2026/big.bin",
                upload_id: &upload_id,
            };
            let local = big.items[0].local.clone();
            let etag = self
                .provider
                .put_part(&target, 1, &local, 0, 8 * 1024 * 1024, Arc::new(|_| {}))
                .await
                .unwrap();
            let modified = worker::modified_ms(&local).unwrap();
            big.items[0].resume = Some(Resume::Upload {
                upload_id,
                part_size: 8 * 1024 * 1024,
                parts: vec![CompletedPart { number: 1, etag }],
                local_size: BIG as u64,
                local_modified_ms: if fingerprint_matches {
                    modified
                } else {
                    modified + 1
                },
            });
            (big, bytes)
        }

        fn download_of(&self, key: &str, size: u64) -> Transfer {
            let mut download = transfer(vec![item(key, size)]);
            download.direction = Direction::Download;
            let local = self.dir.join(key.rsplit('/').next().unwrap());
            download.local_root = local.clone();
            download.items[0].local = local;
            download
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_folder_with_one_file_still_shows_the_folder_in_finder() {
        let provider = Arc::new(
            FakeProvider::empty().with_objects(vec![("2026/photos/a.jpg", b"aa".to_vec())]),
        );
        let h = harness_in(temp_dir(), provider, true);
        h.manager.start().await;
        let target = h.dir.join("photos");
        let mut folder = transfer(vec![item("2026/photos/a.jpg", 2)]);
        folder.kind = Kind::Folder;
        folder.direction = Direction::Download;
        folder.local_root = target.clone();
        folder.items[0].local = target.join("a.jpg");
        let id = h.manager.add(folder).await;
        h.wait_for(id, "finished").await;
        let finished = h
            .events
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find_map(|event| match event {
                Event::State(view) if view.id == id => view.path.clone(),
                _ => None,
            });
        assert_eq!(finished, Some(target.to_string_lossy().into_owned()));
    }

    #[tokio::test(start_paused = true)]
    async fn a_big_upload_goes_in_parts() {
        let h = harness();
        h.manager.start().await;
        let (big, bytes) = h.big_upload();
        let id = h.manager.add(big).await;
        h.wait_for(id, "finished").await;
        assert_eq!(h.provider.object("2026/big.bin"), Some(bytes));
        assert_eq!(h.provider.calls("start_multipart"), 1);
        assert_eq!(h.provider.calls("put_part"), 3);
        assert_eq!(h.provider.calls("complete_multipart"), 1);
        assert_eq!(h.provider.calls("put_file"), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn a_resumed_upload_sends_only_the_missing_parts() {
        let h = harness();
        h.manager.start().await;
        let (big, bytes) = h.upload_with_first_part_sent(true).await;
        let id = h.manager.add(big).await;
        h.wait_for(id, "finished").await;
        assert_eq!(h.provider.object("2026/big.bin"), Some(bytes));
        assert_eq!(h.provider.calls("put_part"), 1 + 2);
        assert_eq!(h.provider.calls("start_multipart"), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_file_changed_while_paused_starts_again() {
        let h = harness();
        h.manager.start().await;
        let (big, bytes) = h.upload_with_first_part_sent(false).await;
        let id = h.manager.add(big).await;
        h.wait_for(id, "finished").await;
        assert_eq!(h.provider.object("2026/big.bin"), Some(bytes));
        assert_eq!(h.provider.calls("abort_multipart"), 1);
        assert_eq!(h.provider.calls("start_multipart"), 2);
        assert_eq!(h.provider.calls("put_part"), 1 + 3);
    }

    #[tokio::test(start_paused = true)]
    async fn an_upload_the_server_forgot_starts_again() {
        let h = harness();
        h.manager.start().await;
        let (mut big, bytes) = h.upload_with_first_part_sent(true).await;
        if let Some(Resume::Upload { upload_id, .. }) = &mut big.items[0].resume {
            *upload_id = "gone".into();
        }
        let id = h.manager.add(big).await;
        h.wait_for(id, "finished").await;
        assert_eq!(h.provider.object("2026/big.bin"), Some(bytes));
        assert_eq!(h.provider.calls("start_multipart"), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_paused_big_upload_still_shows_its_saved_parts() {
        let h = harness();
        h.manager.start().await;
        let (mut big, _) = h.upload_with_first_part_sent(true).await;
        big.status = Status::Paused;
        h.manager.add(big).await;
        let views = h.manager.list().await;
        assert_eq!(
            (views[0].status, views[0].done),
            ("paused", 8 * 1024 * 1024)
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_download_keeps_its_part_file_so_retry_continues() {
        let bytes = patterned(BIG);
        let provider =
            Arc::new(FakeProvider::empty().with_objects(vec![("2026/big.bin", bytes.clone())]));
        let h = harness_in(temp_dir(), provider, true);
        h.manager.start().await;
        let mut download = h.download_of("2026/big.bin", BIG as u64);
        let part = part_path(&download.items[0].local);
        let mut partial = vec![0; BIG];
        partial[..8 * 1024 * 1024].copy_from_slice(&bytes[..8 * 1024 * 1024]);
        std::fs::write(&part, &partial).unwrap();
        download.items[0].resume = Some(Resume::Download {
            etag: "\"v1\"".into(),
            part_path: part.clone(),
            done_ranges: vec![0],
        });
        h.provider.fail_next(1, AppError::AccessDenied);
        let id = h.manager.add(download).await;
        h.wait_for(id, "failed").await;
        assert!(part.exists());
        h.manager.retry(id).await;
        h.wait_for(id, "finished").await;
        assert_eq!(std::fs::read(h.dir.join("big.bin")).unwrap(), bytes);
        assert_eq!(h.provider.calls("get_range"), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_big_download_comes_in_ranges() {
        let bytes = patterned(BIG);
        let provider =
            Arc::new(FakeProvider::empty().with_objects(vec![("2026/big.bin", bytes.clone())]));
        let h = harness_in(temp_dir(), provider, true);
        h.manager.start().await;
        let id = h
            .manager
            .add(h.download_of("2026/big.bin", BIG as u64))
            .await;
        h.wait_for(id, "finished").await;
        assert_eq!(std::fs::read(h.dir.join("big.bin")).unwrap(), bytes);
        assert_eq!(h.provider.calls("get_range"), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn a_resumed_download_fetches_only_the_missing_ranges() {
        let bytes = patterned(BIG);
        let provider =
            Arc::new(FakeProvider::empty().with_objects(vec![("2026/big.bin", bytes.clone())]));
        let h = harness_in(temp_dir(), provider, true);
        h.manager.start().await;
        let mut download = h.download_of("2026/big.bin", BIG as u64);
        let part = part_path(&download.items[0].local);
        let mut partial = vec![0; BIG];
        partial[..8 * 1024 * 1024].copy_from_slice(&bytes[..8 * 1024 * 1024]);
        std::fs::write(&part, &partial).unwrap();
        download.items[0].resume = Some(Resume::Download {
            etag: "\"v1\"".into(),
            part_path: part,
            done_ranges: vec![0],
        });
        let id = h.manager.add(download).await;
        h.wait_for(id, "finished").await;
        assert_eq!(std::fs::read(h.dir.join("big.bin")).unwrap(), bytes);
        assert_eq!(h.provider.calls("get_range"), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_download_whose_object_changed_starts_again() {
        let bytes = patterned(BIG);
        let provider =
            Arc::new(FakeProvider::empty().with_objects(vec![("2026/big.bin", bytes.clone())]));
        let h = harness_in(temp_dir(), provider, true);
        h.manager.start().await;
        let mut download = h.download_of("2026/big.bin", BIG as u64);
        let part = part_path(&download.items[0].local);
        std::fs::write(&part, vec![7; BIG]).unwrap();
        download.items[0].resume = Some(Resume::Download {
            etag: "\"old\"".into(),
            part_path: part,
            done_ranges: vec![0, 1],
        });
        let id = h.manager.add(download).await;
        h.wait_for(id, "finished").await;
        assert_eq!(std::fs::read(h.dir.join("big.bin")).unwrap(), bytes);
        assert_eq!(h.provider.calls("get_range"), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn empty_files_go_up_and_down() {
        let provider =
            Arc::new(FakeProvider::empty().with_objects(vec![("2026/empty.txt", Vec::new())]));
        let h = harness_in(temp_dir(), provider, true);
        h.manager.start().await;
        let up = h.manager.add(h.upload("nothing.txt", b"")).await;
        let down = h.manager.add(h.download_of("2026/empty.txt", 0)).await;
        h.wait_for(up, "finished").await;
        h.wait_for(down, "finished").await;
        assert_eq!(h.provider.object("2026/nothing.txt"), Some(Vec::new()));
        assert_eq!(
            std::fs::read(h.dir.join("empty.txt")).unwrap(),
            Vec::<u8>::new()
        );
    }

    #[tokio::test(start_paused = true)]
    async fn cancelling_aborts_the_upload_and_deletes_the_part_file() {
        let bytes = patterned(BIG);
        let provider =
            Arc::new(FakeProvider::empty().with_objects(vec![("2026/other.bin", bytes)]));
        let h = harness_in(temp_dir(), provider, true);
        h.manager.start().await;
        let (big, _) = h.upload_with_first_part_sent(true).await;
        let mut download = h.download_of("2026/other.bin", BIG as u64);
        let part = part_path(&download.items[0].local);
        std::fs::write(&part, vec![0; BIG]).unwrap();
        download.items[0].resume = Some(Resume::Download {
            etag: "\"v1\"".into(),
            part_path: part.clone(),
            done_ranges: vec![0],
        });
        h.provider.hold();
        let up = h.manager.add(big).await;
        let down = h.manager.add(download).await;
        h.settle().await;
        h.manager.cancel(up).await;
        h.manager.cancel(down).await;
        assert_eq!(h.provider.calls("abort_multipart"), 1);
        assert_eq!(h.provider.open_uploads(), 0);
        assert!(!part.exists());
    }

    #[tokio::test(start_paused = true)]
    async fn a_folder_with_one_bad_name_finishes_the_rest_and_fails_with_a_count() {
        let provider = Arc::new(FakeProvider::empty().with_objects(vec![
            ("2026/photos/a.jpg", b"aa".to_vec()),
            ("2026/photos/raw/b.dng", b"bbb".to_vec()),
        ]));
        let h = harness_in(temp_dir(), provider, true);
        h.manager.start().await;
        let target = h.dir.join("photos");
        let mut folder = transfer(vec![
            item("2026/photos/a.jpg", 2),
            item("2026/photos/raw/", 0),
            item("2026/photos/raw/b.dng", 3),
            item("2026/photos/../evil", 1),
        ]);
        folder.direction = Direction::Download;
        folder.local_root = target.clone();
        for one in &mut folder.items {
            match crate::transfers::plan::download_target("2026/photos/", &one.key, &target) {
                Some(local) => one.local = local,
                None => {
                    one.state = ItemState::Failed {
                        message: "This name can't be saved on a Mac.".into(),
                    }
                }
            }
        }
        let id = h.manager.add(folder).await;
        h.wait_for(id, "failed").await;
        assert_eq!(std::fs::read(target.join("a.jpg")).unwrap(), b"aa");
        assert_eq!(
            std::fs::read(target.join("raw").join("b.dng")).unwrap(),
            b"bbb"
        );
        assert!(!h.dir.join("evil").exists());
        let views = h.manager.list().await;
        assert_eq!(views[0].error.as_deref(), Some("1 file failed."));
        assert_eq!((views[0].files_done, views[0].files_failed), (3, 1));
    }

    #[tokio::test(start_paused = true)]
    async fn an_upload_runs_and_finishes() {
        let h = harness();
        h.manager.start().await;
        let id = h.manager.add(h.upload("a.txt", b"hello")).await;
        h.wait_for(id, "finished").await;
        assert_eq!(h.provider.object("2026/a.txt"), Some(b"hello".to_vec()));
        assert_eq!(h.statuses(id).first(), Some(&"waiting"));
        assert!(h.manager.list().await.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn a_download_is_saved_under_its_own_name() {
        let h = harness();
        h.provider.fail_next(0, AppError::Network);
        let provider =
            Arc::new(FakeProvider::empty().with_objects(vec![("2026/b.txt", b"hi".to_vec())]));
        let h = harness_in(h.dir.clone(), provider, true);
        h.manager.start().await;
        let mut download = transfer(vec![item("2026/b.txt", 2)]);
        download.direction = Direction::Download;
        download.local_root = h.dir.join("b.txt");
        download.items[0].local = h.dir.join("b.txt");
        let id = h.manager.add(download).await;
        h.wait_for(id, "finished").await;
        assert_eq!(std::fs::read(h.dir.join("b.txt")).unwrap(), b"hi");
        assert!(!h.dir.join("b.txt.part").exists());
    }

    #[tokio::test(start_paused = true)]
    async fn never_more_than_four_run_at_once() {
        let h = harness();
        h.provider.hold();
        h.manager.start().await;
        let mut ids = Vec::new();
        for n in 0..6 {
            ids.push(h.manager.add(h.upload(&format!("{n}.txt"), b"x")).await);
        }
        h.settle().await;
        assert_eq!(h.current("running").await, 4);
        assert_eq!(h.current("waiting").await, 2);
        h.provider.release();
        for id in ids {
            h.wait_for(id, "finished").await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn network_errors_retry_then_succeed() {
        let h = harness();
        h.provider.fail_next(2, AppError::Network);
        h.manager.start().await;
        let id = h.manager.add(h.upload("a.txt", b"x")).await;
        h.wait_for(id, "finished").await;
        assert!(h.statuses(id).contains(&"retrying"));
        assert_eq!(h.provider.calls("put_file"), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn waiting_to_retry_does_not_rewrite_the_saved_queue() {
        let h = harness();
        h.provider.fail_next(1, AppError::Network);
        h.manager.start().await;
        let id = h.manager.add(h.upload("a.txt", b"x")).await;
        h.wait_for(id, "retrying").await;
        let saved = std::fs::read_to_string(h.dir.join("transfers.json")).unwrap();
        assert!(saved.contains("\"running\""), "{saved}");
        assert!(!saved.contains("retrying"), "{saved}");
        assert!(!saved.contains("\n  "), "saved file should be compact");
    }

    #[tokio::test(start_paused = true)]
    async fn five_network_errors_fail_the_transfer() {
        let h = harness();
        h.provider.fail_next(5, AppError::Network);
        h.manager.start().await;
        let id = h.manager.add(h.upload("a.txt", b"x")).await;
        h.wait_for(id, "failed").await;
        assert_eq!(h.provider.calls("put_file"), 5);
        let failed = h.manager.list().await;
        assert_eq!(
            failed[0].error.as_deref(),
            Some(AppError::Network.to_string().as_str())
        );
    }

    #[tokio::test(start_paused = true)]
    async fn access_denied_fails_at_once() {
        let h = harness();
        h.provider.fail_next(1, AppError::AccessDenied);
        h.manager.start().await;
        let id = h.manager.add(h.upload("a.txt", b"x")).await;
        h.wait_for(id, "failed").await;
        assert_eq!(h.provider.calls("put_file"), 1);
        assert!(!h.statuses(id).contains(&"retrying"));
    }

    #[tokio::test(start_paused = true)]
    async fn pausing_a_running_transfer_lets_the_next_one_start() {
        let h = harness();
        h.provider.hold();
        h.manager.start().await;
        let mut ids = Vec::new();
        for n in 0..5 {
            ids.push(h.manager.add(h.upload(&format!("{n}.txt"), b"x")).await);
        }
        h.settle().await;
        h.manager.pause(ids[0]).await;
        h.settle().await;
        assert_eq!(h.current("paused").await, 1);
        assert_eq!(h.current("running").await, 4);
        h.provider.release();
        h.wait_for(ids[4], "finished").await;
        h.manager.resume(ids[0]).await;
        h.wait_for(ids[0], "finished").await;
    }

    #[tokio::test(start_paused = true)]
    async fn cancelling_a_waiting_transfer_removes_it() {
        let h = harness();
        h.provider.hold();
        h.manager.start().await;
        let mut ids = Vec::new();
        for n in 0..5 {
            ids.push(h.manager.add(h.upload(&format!("{n}.txt"), b"x")).await);
        }
        h.manager.cancel(ids[4]).await;
        assert_eq!(h.statuses(ids[4]).last(), Some(&"cancelled"));
        assert!(h.manager.list().await.iter().all(|view| view.id != ids[4]));
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_transfer_can_be_retried() {
        let h = harness();
        h.provider.fail_next(1, AppError::AccessDenied);
        h.manager.start().await;
        let id = h.manager.add(h.upload("a.txt", b"x")).await;
        h.wait_for(id, "failed").await;
        h.manager.retry(id).await;
        h.wait_for(id, "finished").await;
    }

    #[tokio::test(start_paused = true)]
    async fn a_deleted_connection_fails_its_transfers() {
        let h = harness_in(temp_dir(), Arc::new(FakeProvider::empty()), false);
        h.manager.start().await;
        let id = h.manager.add(h.upload("a.txt", b"x")).await;
        h.wait_for(id, "failed").await;
        let failed = h.manager.list().await;
        assert_eq!(
            failed[0].error.as_deref(),
            Some(AppError::ConnectionNotFound.to_string().as_str())
        );
    }

    #[tokio::test(start_paused = true)]
    async fn paused_transfers_are_still_there_after_a_restart() {
        let h = harness();
        h.provider.hold();
        h.manager.start().await;
        let id = h.manager.add(h.upload("a.txt", b"x")).await;
        h.manager.pause(id).await;
        let reopened = harness_in(h.dir.clone(), Arc::new(FakeProvider::empty()), true);
        reopened.manager.start().await;
        let views = reopened.manager.list().await;
        assert_eq!(views.len(), 1);
        assert_eq!((views[0].id, views[0].status), (id, "paused"));
    }

    #[tokio::test(start_paused = true)]
    async fn pause_all_and_resume_all_cover_every_transfer() {
        let h = harness();
        h.provider.hold();
        h.manager.start().await;
        for n in 0..5 {
            h.manager.add(h.upload(&format!("{n}.txt"), b"x")).await;
        }
        h.manager.pause_all().await;
        assert_eq!(h.current("paused").await, 5);
        h.provider.release();
        h.manager.resume_all().await;
        for _ in 0..1000 {
            if h.manager.list().await.is_empty() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("transfers never finished");
    }
}

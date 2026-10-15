use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinHandle;
use uuid::Uuid;

use super::model::{ItemState, Status, Transfer, TransferProgress, TransferView};
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
            self.changed(&mut inner, id);
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
            self.changed(&mut inner, id);
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

    pub(super) async fn item_done(&self, id: Uuid, index: usize, saved_as: Option<PathBuf>) {
        let mut inner = self.inner.lock().await;
        inner.in_flight.remove(&(id, index));
        if let Some(transfer) = inner.queue.get_mut(id) {
            let single = transfer.items.len() == 1;
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
        if let Some(view) = inner.view(id) {
            (self.emit)(Event::State(view));
        }
        self.save(inner);
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
    use crate::testing::FakeProvider;
    use crate::transfers::model::tests::{item, transfer};
    use crate::transfers::model::{Direction, Transfer};
    use crate::transfers::store::TransferStore;

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

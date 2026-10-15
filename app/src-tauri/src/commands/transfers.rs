use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::error::AppError;
use crate::providers::ProgressFn;
use crate::providers::s3::MAX_SINGLE_UPLOAD;
use crate::state::AppState;
use crate::transfers::paths::{
    Direction, Throttle, TransferInfo, TransferProgress, TransferStateEvent, TransferStatus,
    finish_download, reserve_download, safe_file_name,
};

struct Running {
    task: JoinHandle<()>,
    partial: Option<PathBuf>,
}

const MAX_RUNNING_TRANSFERS: usize = 4;

pub struct Transfers {
    running: Mutex<HashMap<Uuid, Running>>,
    slots: Arc<Semaphore>,
}

impl Default for Transfers {
    fn default() -> Self {
        Self {
            running: Mutex::default(),
            slots: Arc::new(Semaphore::new(MAX_RUNNING_TRANSFERS)),
        }
    }
}

impl Transfers {
    fn spawn<F>(&self, id: Uuid, partial: Option<PathBuf>, work: F) -> Result<(), AppError>
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let mut map = self
            .running
            .lock()
            .map_err(|_| AppError::Io("The transfer list is unavailable.".into()))?;
        let slots = self.slots.clone();
        let task = tauri::async_runtime::spawn(async move {
            let _slot = slots.acquire_owned().await;
            work.await;
        });
        map.insert(id, Running { task, partial });
        Ok(())
    }

    fn take(&self, id: Uuid) -> Option<Running> {
        self.running.lock().ok().and_then(|mut map| map.remove(&id))
    }
}

fn emit_state(app: &AppHandle, event: TransferStateEvent) {
    app.emit("transfer://state", event).ok();
}

fn state_event(id: Uuid, state: TransferStatus) -> TransferStateEvent {
    TransferStateEvent {
        id,
        state,
        info: None,
        error: None,
        path: None,
    }
}

fn progress_reporter(app: AppHandle, id: Uuid, total: u64) -> ProgressFn {
    let throttle = Mutex::new(Throttle::new(Duration::from_millis(100)));
    Arc::new(move |done| {
        let ready = throttle
            .lock()
            .map(|mut throttle| throttle.ready(Instant::now(), done >= total))
            .unwrap_or(true);
        if ready {
            app.emit("transfer://progress", TransferProgress { id, done, total })
                .ok();
        }
    })
}

fn finish(app: &AppHandle, id: Uuid, outcome: Result<Option<PathBuf>, AppError>) {
    if app.state::<Transfers>().take(id).is_none() {
        return;
    }
    let event = match outcome {
        Ok(path) => TransferStateEvent {
            path: path.map(|path| path.to_string_lossy().into_owned()),
            ..state_event(id, TransferStatus::Finished)
        },
        Err(error) => TransferStateEvent {
            error: Some(error),
            ..state_event(id, TransferStatus::Failed)
        },
    };
    emit_state(app, event);
}

fn fail(app: &AppHandle, id: Uuid, error: AppError) {
    emit_state(
        app,
        TransferStateEvent {
            error: Some(error),
            ..state_event(id, TransferStatus::Failed)
        },
    );
}

fn save_download(part: &Path, target: PathBuf, name: &str) -> Result<PathBuf, AppError> {
    let dir = target.parent().unwrap_or(Path::new("."));
    Ok(finish_download(dir, name, part, target.clone())?)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    id: Uuid,
    bucket: String,
    prefix: String,
    path: String,
    replace: bool,
) -> Result<Uuid, AppError> {
    let provider = state.provider(id).await?;
    let path = PathBuf::from(path);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Io("That file has no name.".into()))?
        .to_string();
    let total = tokio::fs::metadata(&path).await?.len();
    if total > MAX_SINGLE_UPLOAD {
        return Err(AppError::FileTooLarge);
    }
    let key = format!("{prefix}{name}");
    if !replace && provider.list_keys(&bucket, &key, None).await?.keys.first() == Some(&key) {
        return Err(AppError::AlreadyExists(name));
    }

    let transfer = Uuid::new_v4();
    let info = TransferInfo {
        id: transfer,
        direction: Direction::Upload,
        name,
        destination: format!("{bucket}/{prefix}"),
        total,
    };
    emit_state(
        &app,
        TransferStateEvent {
            info: Some(info),
            ..state_event(transfer, TransferStatus::Running)
        },
    );

    let progress = progress_reporter(app.clone(), transfer, total);
    let task_app = app.clone();
    app.state::<Transfers>()
        .spawn(transfer, None, async move {
            let outcome = provider
                .put_file(&bucket, &key, &path, progress)
                .await
                .map(|()| None);
            finish(&task_app, transfer, outcome);
        })
        .inspect_err(|error| fail(&app, transfer, error.clone()))?;
    Ok(transfer)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    id: Uuid,
    bucket: String,
    key: String,
    size: u64,
) -> Result<Uuid, AppError> {
    let provider = state.provider(id).await?;
    let dir = app
        .path()
        .download_dir()
        .map_err(|error| AppError::Io(error.to_string()))?;
    let name = safe_file_name(&key);
    let (target, partial) = reserve_download(&dir, &name)?;

    let transfer = Uuid::new_v4();
    let info = TransferInfo {
        id: transfer,
        direction: Direction::Download,
        name: name.clone(),
        destination: target.to_string_lossy().into_owned(),
        total: size,
    };
    emit_state(
        &app,
        TransferStateEvent {
            info: Some(info),
            ..state_event(transfer, TransferStatus::Running)
        },
    );

    let progress = progress_reporter(app.clone(), transfer, size);
    let task_app = app.clone();
    let task_partial = partial.clone();
    let spawned = app
        .state::<Transfers>()
        .spawn(transfer, Some(partial.clone()), async move {
            let outcome = match provider
                .get_file(&bucket, &key, &task_partial, progress)
                .await
            {
                Ok(()) => save_download(&task_partial, target, &name).map(Some),
                Err(error) => Err(error),
            };
            if outcome.is_err() {
                std::fs::remove_file(&task_partial).ok();
            }
            finish(&task_app, transfer, outcome);
        });
    if let Err(error) = &spawned {
        std::fs::remove_file(&partial).ok();
        fail(&app, transfer, error.clone());
    }
    spawned?;
    Ok(transfer)
}

#[tauri::command]
pub async fn cancel_transfer(app: AppHandle, transfer: Uuid) -> Result<(), AppError> {
    if let Some(running) = app.state::<Transfers>().take(transfer) {
        running.task.abort();
        running.task.await.ok();
        if let Some(partial) = running.partial {
            std::fs::remove_file(partial).ok();
        }
        emit_state(&app, state_event(transfer, TransferStatus::Cancelled));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    fn wait_until(check: impl Fn() -> bool) {
        for _ in 0..200 {
            if check() {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("timed out");
    }

    #[test]
    fn only_four_transfers_run_at_once_and_cancelling_frees_a_slot() {
        let transfers = Transfers::default();
        let started = Arc::new(AtomicUsize::new(0));
        let ids: Vec<Uuid> = (0..6).map(|_| Uuid::new_v4()).collect();
        for id in &ids {
            let started = started.clone();
            transfers
                .spawn(*id, None, async move {
                    started.fetch_add(1, Ordering::SeqCst);
                    std::future::pending::<()>().await;
                })
                .unwrap();
        }
        wait_until(|| started.load(Ordering::SeqCst) == 4);
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(started.load(Ordering::SeqCst), 4);

        transfers.take(ids[5]).unwrap().task.abort();
        transfers.take(ids[0]).unwrap().task.abort();
        wait_until(|| started.load(Ordering::SeqCst) == 5);
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(started.load(Ordering::SeqCst), 5);
    }

    #[test]
    fn only_the_first_taker_owns_a_transfer() {
        let transfers = Transfers::default();
        let id = Uuid::new_v4();
        transfers.spawn(id, None, async {}).unwrap();
        assert!(transfers.take(id).is_some());
        assert!(transfers.take(id).is_none());
    }
}

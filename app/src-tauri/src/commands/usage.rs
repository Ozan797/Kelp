use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;
use crate::usage::{UsageCounts, UsageView};

type Counts<'a> = State<'a, Arc<UsageCounts>>;

#[tauri::command]
pub async fn get_usage(
    counts: Counts<'_>,
    id: Uuid,
    bucket: String,
    prefix: String,
) -> Result<Option<UsageView>, AppError> {
    Ok(counts.get(id, &bucket, &prefix))
}

#[tauri::command]
pub async fn start_usage_count(
    app: AppHandle,
    state: State<'_, AppState>,
    counts: Counts<'_>,
    id: Uuid,
    bucket: String,
    prefix: String,
) -> Result<Option<UsageView>, AppError> {
    let provider = state.provider(id).await?;
    let emit = Arc::new(move |view: UsageView| {
        app.emit("usage://progress", view).ok();
    });
    counts.start(provider, id, &bucket, &prefix, emit);
    Ok(counts.get(id, &bucket, &prefix))
}

#[tauri::command]
pub async fn cancel_usage_count(
    counts: Counts<'_>,
    id: Uuid,
    bucket: String,
    prefix: String,
) -> Result<Option<UsageView>, AppError> {
    Ok(counts.cancel(id, &bucket, &prefix).await)
}

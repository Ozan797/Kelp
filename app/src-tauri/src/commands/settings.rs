use tauri::State;

use crate::error::AppError;
use crate::settings::{Settings, SettingsStore};

#[tauri::command]
pub async fn get_settings(store: State<'_, SettingsStore>) -> Result<Settings, AppError> {
    Ok(store.load())
}

#[tauri::command]
pub async fn set_settings(
    store: State<'_, SettingsStore>,
    settings: Settings,
) -> Result<Settings, AppError> {
    store.save(&settings)?;
    Ok(settings)
}

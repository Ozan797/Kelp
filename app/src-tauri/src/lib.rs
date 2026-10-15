pub mod commands;
pub mod connection;
pub mod error;
pub mod json_file;
pub mod profiles;
pub mod providers;
pub mod secrets;
pub mod state;
#[cfg(test)]
pub mod testing;
pub mod transfers;
pub mod usage;
pub mod validation;

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::commands::{
    browse, connections, transfers as transfer_commands, uploads as upload_commands,
    usage as usage_commands,
};
use crate::profiles::ProfileStore;
use crate::secrets::KeychainStore;
use crate::state::{AppState, real_connect};
use crate::transfers::manager::{Event, ProviderFor, TransferManager};
use crate::transfers::store::TransferStore;
use crate::usage::{UsageCounts, UsageStore};

fn transfer_manager(app: &AppHandle, dir: &std::path::Path) -> Arc<TransferManager> {
    let events = app.clone();
    let providers = app.clone();
    let provider_for: ProviderFor = Arc::new(move |id| {
        let app = providers.clone();
        Box::pin(async move { app.state::<AppState>().provider(id).await })
    });
    TransferManager::new(
        TransferStore::new(dir),
        Arc::new(move |event| {
            match event {
                Event::State(view) => events.emit("transfer://state", view),
                Event::Progress(progress) => events.emit("transfer://progress", progress),
            }
            .ok();
        }),
        provider_for,
    )
}

pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let state = AppState::new(
                ProfileStore::new(&dir),
                Box::new(KeychainStore),
                real_connect(),
            );
            app.manage(state);
            let manager = transfer_manager(app.handle(), &dir);
            app.manage(manager.clone());
            app.manage(UsageCounts::new(UsageStore::new(&dir)));
            tauri::async_runtime::spawn(async move { manager.start().await });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connections::list_connections,
            connections::test_connection,
            connections::save_connection,
            connections::delete_connection,
            connections::set_last_location,
            browse::list_buckets,
            browse::list_objects,
            browse::create_folder,
            browse::delete_objects,
            transfer_commands::list_transfers,
            transfer_commands::start_download,
            upload_commands::inspect_drop,
            upload_commands::plan_upload,
            upload_commands::start_uploads,
            transfer_commands::start_folder_download,
            transfer_commands::pause_transfer,
            transfer_commands::resume_transfer,
            transfer_commands::retry_transfer,
            transfer_commands::cancel_transfer,
            transfer_commands::pause_all,
            transfer_commands::resume_all,
            usage_commands::get_usage,
            usage_commands::start_usage_count,
            usage_commands::cancel_usage_count,
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("Kelp could not start: {error}");
        std::process::exit(1);
    }
}

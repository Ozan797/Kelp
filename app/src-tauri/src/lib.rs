pub mod commands;
pub mod connection;
pub mod error;
pub mod profiles;
pub mod providers;
pub mod secrets;
pub mod state;
#[cfg(test)]
pub mod testing;
pub mod transfers;
pub mod validation;

use tauri::Manager;

use crate::commands::{browse, connections, transfers as transfer_commands};
use crate::profiles::ProfileStore;
use crate::secrets::KeychainStore;
use crate::state::{AppState, real_connect};

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
            )?;
            app.manage(state);
            app.manage(transfer_commands::Transfers::default());
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
            transfer_commands::start_upload,
            transfer_commands::start_download,
            transfer_commands::cancel_transfer,
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("Kelp could not start: {error}");
        std::process::exit(1);
    }
}

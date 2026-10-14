pub mod connection;
pub mod error;
pub mod providers;

pub fn run() {
    if let Err(error) = tauri::Builder::default().run(tauri::generate_context!()) {
        eprintln!("Kelp could not start: {error}");
        std::process::exit(1);
    }
}

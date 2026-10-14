//! Kelp's Rust core. For now it only starts the window; commands, providers and transfers
//! arrive from milestone M1 (see SPEC.md section 4).

/// Builds and runs the Tauri app. Called from `main.rs`.
pub fn run() {
    // `run` returns a `Result`. If the app can't start (for example a broken config), say why and
    // exit with an error code instead of panicking: CLAUDE.md avoids `expect()` outside tests.
    if let Err(error) = tauri::Builder::default().run(tauri::generate_context!()) {
        eprintln!("Kelp could not start: {error}");
        std::process::exit(1);
    }
}

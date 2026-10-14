// Stops an extra console window opening on Windows in release builds. Harmless on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kelp_lib::run()
}

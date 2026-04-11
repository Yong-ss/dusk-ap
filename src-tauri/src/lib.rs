mod commands;
mod models;
mod platform;

use std::sync::{atomic::AtomicBool, Arc};
use tokio::sync::RwLock;

use crate::models::MftCache;

/// Shared global state. Managed by Tauri so commands can borrow it.
pub struct ScanState {
    pub cancel: Arc<AtomicBool>,
    pub cache: Arc<RwLock<Option<MftCache>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ScanState {
            cancel: Arc::new(AtomicBool::new(false)),
            cache: Arc::new(RwLock::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_directory,
            commands::get_folder_files,
            commands::cancel_scan,
            commands::delete_path,
            commands::get_drives,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

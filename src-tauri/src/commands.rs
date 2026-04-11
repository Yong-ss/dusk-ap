use std::sync::{
    atomic::Ordering,
    mpsc,
    Arc,
};

use tauri::{AppHandle, Emitter, State};

use crate::{
    models::ScanError,
    platform::create_scanner,
    ScanState,
};

// ── Commands ──────────────────────────────────────────────────────────────────

/// Start scanning `path` and stream `scan_chunk` events to the window.
///
/// The function returns as soon as the scan is launched on a background thread.
/// All results arrive via Tauri events.
#[tauri::command]
pub async fn scan_directory(
    path: String,
    app: AppHandle,
    state: State<'_, ScanState>,
) -> Result<(), String> {
    // Reset cancel flag for the new scan.
    state.cancel.store(false, Ordering::Relaxed);
    let cancel = Arc::clone(&state.cancel);

    tokio::task::spawn_blocking(move || {
        let scanner = create_scanner(&path);
        let (tx, rx) = mpsc::channel();

        // Spawn event-relay thread so we don't block the scan loop on IPC.
        let app_clone = app.clone();
        std::thread::spawn(move || {
            for chunk in rx {
                if let Err(e) = app_clone.emit("scan_chunk", &chunk) {
                    eprintln!("[dusk/cmd] emit error: {e}");
                }
            }
        });

        match scanner.scan(&path, tx, cancel) {
            Ok(()) => {}
            Err(ScanError::Cancelled) => {
                eprintln!("[dusk/cmd] scan cancelled by user");
            }
            Err(e) => {
                eprintln!("[dusk/cmd] scan error: {e}");
                // Emit an error event so the frontend can show a message.
                let _ = app.emit("scan_error", e.to_string());
            }
        }
    });

    Ok(())
}

/// Signal the active scan to stop.
#[tauri::command]
pub async fn cancel_scan(state: State<'_, ScanState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::Relaxed);
    Ok(())
}

/// Delete a file or directory recursively.
#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

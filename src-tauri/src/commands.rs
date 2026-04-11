use std::sync::{
    atomic::Ordering,
    mpsc,
    Arc,
};

use tauri::{AppHandle, Emitter, State};

use sysinfo::Disks;

use crate::{
    models::{ScanError, ScanOptions, DriveInfo},
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
    options: ScanOptions,
    app: AppHandle,
    state: State<'_, ScanState>,
) -> Result<(), String> {
    // Reset cancel flag for the new scan.
    state.cancel.store(false, Ordering::Relaxed);
    let cancel = Arc::clone(&state.cancel);

    tokio::task::spawn_blocking(move || {
        // Boot the scanner factory
        let (scanner, method) = create_scanner(&path, options.clone());

        // Emit scan start event
        let _ = app.emit("scan_start", serde_json::json!({ "method": method }));

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

        let mut current_method = method;
        let mut current_scanner = scanner;

        loop {
            match current_scanner.scan(&path, tx.clone(), cancel.clone()) {
                Ok(()) => break,
                Err(ScanError::Cancelled) => {
                    eprintln!("[dusk/cmd] scan cancelled by user");
                    break;
                }
                Err(e) if current_method == "mft" => {
                    eprintln!("[dusk/cmd] MFT scan failed, falling back to walkdir: {e}");
                    // Fallback to walkdir
                    current_method = "walkdir";
                    let (fallback_scanner, _) = create_scanner(&path, options.clone());
                    current_scanner = fallback_scanner;
                    
                    // Notify frontend of method change
                    let _ = app.emit("scan_start", serde_json::json!({ "method": "walkdir" }));
                    continue;
                }
                Err(e) => {
                    eprintln!("[dusk/cmd] scan error: {e}");
                    // Emit an error event so the frontend can show a message.
                    let _ = app.emit("scan_error", e.to_string());
                    break;
                }
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

/// Get mounted physical drives on the host OS using `sysinfo`
#[tauri::command]
pub fn get_drives() -> Result<Vec<DriveInfo>, String> {
    let disks = Disks::new_with_refreshed_list();
    let mut result = Vec::new();

    for disk in disks.list() {
        if disk.total_space() == 0 {
            continue;
        }

        let name = disk.name().to_string_lossy().to_string();
        let name = if name.is_empty() {
            "Local Disk".to_string()
        } else {
            name
        };

        result.push(DriveInfo {
            name,
            mount_point: disk.mount_point().to_string_lossy().to_string(),
            total_space: disk.total_space(),
            available_space: disk.available_space(),
        });
    }

    Ok(result)
}
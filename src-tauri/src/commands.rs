use std::sync::{
    atomic::Ordering,
    mpsc,
    Arc,
};

use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use sysinfo::Disks;

use crate::{
    models::{ScanOptions, DriveInfo},
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
    println!("\n[dusk/core] 📥 RECEIVED SCAN REQUEST");
    println!("[dusk/core] path:    {}", path);
    println!("[dusk/core] options: {:?}", options);

    // Reset cancel flag for the new scan.
    state.cancel.store(false, Ordering::Relaxed);
    let cancel = Arc::clone(&state.cancel);

    tokio::task::spawn_blocking(move || {
        println!("[dusk/core] 🚀 Launching scanner thread...");
        let (scanner, method) = create_scanner(&path, options.clone());
        println!("[dusk/core] 🛠 Scanner selected: {}", method);

        let _ = app.emit("scan_start", json!({ "method": method }));

        let (tx, rx) = mpsc::channel();

        let app_clone = app.clone();
        std::thread::spawn(move || {
            for chunk in rx {
                if let Err(e) = app_clone.emit("scan_chunk", &chunk) {
                    eprintln!("[dusk/cmd] emit error: {e}");
                }
            }
        });

        if let Err(e) = scanner.scan(&path, tx, cancel) {
             eprintln!("[dusk/cmd] scan error: {e}");
             let _ = app.emit("scan_error", e.to_string());
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
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
    scan_id: String,
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
    let cache = Arc::clone(&state.cache);

    tokio::task::spawn_blocking(move || {
        println!("[dusk/core] 🚀 Launching scanner thread... (ID: {})", scan_id);
        let (scanner, method) = create_scanner(&path, options.clone());
        println!("[dusk/core] 🛠 Scanner selected: {}", method);

        let _ = app.emit("scan_start", json!({ "method": method, "scanId": scan_id }));

        let (tx, rx) = mpsc::channel();

        let app_clone = app.clone();
        std::thread::spawn(move || {
            for chunk in rx {
                if let Err(e) = app_clone.emit("scan_chunk", &chunk) {
                    eprintln!("[dusk/cmd] emit error: {e}");
                }
            }
        });

        if let Err(e) = scanner.scan(&path, scan_id, tx, cancel, cache) {
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

/// Instantly fetch all files for a specific parsed folder using the in-memory cache.
#[tauri::command]
pub async fn get_folder_files(
    folder_id: String,
    state: State<'_, ScanState>
) -> Result<Vec<crate::models::FileNode>, String> {
    let id = folder_id.parse::<u64>().map_err(|e| e.to_string())?;
    
    let cache_lock = state.cache.read().await;
    let cache = if let Some(c) = cache_lock.as_ref() { c } else { return Ok(vec![]); };

    if id as usize >= cache.hierarchy.len() {
        return Ok(vec![]);
    }

    let children = &cache.hierarchy[id as usize];
    let mut files = Vec::new();

    for &cid in children {
        if let Some(entry) = &cache.raw_entries[cid as usize] {
            if entry.kind == crate::models::NodeKind::File {
                files.push(crate::models::FileNode {
                    id: cid.to_string(),
                    name: entry.name.clone(),
                    path: String::new(), // Reconstructed natively on UI side if needed
                    parent_id: Some(id.to_string()),
                    size: entry.size,
                    kind: crate::models::NodeKind::File,
                    extension: None,
                    children: None,
                    modified: None,
                });
            }
        }
    }

    // Sort by size descending
    files.sort_by(|a, b| b.size.cmp(&a.size));

    Ok(files)
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
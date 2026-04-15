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

/// Fetch files for a folder. Tries MFT cache first, falls back to fs::read_dir.
#[tauri::command]
pub async fn get_folder_files(
    folder_id: String,
    folder_path: String,
    state: State<'_, ScanState>
) -> Result<Vec<crate::models::FileNode>, String> {
    // ── Try MFT cache first ──
    if let Ok(id) = folder_id.parse::<u64>() {
        let cache_lock = state.cache.read().await;
        if let Some(cache) = cache_lock.as_ref() {
            if (id as usize) < cache.hierarchy.len() {
                let children = &cache.hierarchy[id as usize];
                let mut files = Vec::new();

                for &cid in children {
                    if let Some(entry) = &cache.raw_entries[cid as usize] {
                        if entry.kind == crate::models::NodeKind::File {
                            let ext = entry.name.rsplit('.').next()
                                .filter(|e| e.len() < 10 && *e != entry.name)
                                .map(|e| e.to_lowercase());
                            let path = if folder_path.is_empty() {
                                entry.name.clone()
                            } else {
                                format!("{}\\{}", folder_path, entry.name)
                            };
                            files.push(crate::models::FileNode {
                                id: cid.to_string(),
                                name: entry.name.clone(),
                                path,
                                parent_id: Some(id.to_string()),
                                size: entry.size,
                                kind: crate::models::NodeKind::File,
                                extension: ext,
                                children: None,
                                modified: None,
                            });
                        }
                    }
                }

                if !files.is_empty() {
                    files.sort_by(|a, b| b.size.cmp(&a.size));
                    return Ok(files);
                }
            }
        }
    }

    // ── Fallback: read from filesystem ──
    if folder_path.is_empty() {
        return Ok(vec![]);
    }

    let path = std::path::Path::new(&folder_path);
    if !path.is_dir() {
        return Ok(vec![]);
    }

    let mut files = Vec::new();
    let read_dir = std::fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in read_dir.flatten() {
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() { continue; }

        let name = entry.file_name().to_string_lossy().to_string();
        let file_path = entry.path().to_string_lossy().to_string();
        let ext = name.rsplit('.').next()
            .filter(|e| e.len() < 10 && *e != name)
            .map(|e| e.to_lowercase());

        files.push(crate::models::FileNode {
            id: file_path.clone(),
            name,
            path: file_path,
            parent_id: None,
            size: meta.len(),
            kind: crate::models::NodeKind::File,
            extension: ext,
            children: None,
            modified: None,
        });
    }

    files.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(files)
}

/// Delete a file or directory by moving to the OS trash/recycle bin.
/// Falls back to permanent deletion only if trash is unavailable.
#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    let canon = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let canon_str = canon.to_string_lossy();

    // Block obviously dangerous paths (volume roots, system dirs)
    let stripped = canon_str.trim_end_matches(['/', '\\']);
    if stripped.len() <= 3 {
        return Err("Refusing to delete a volume root.".into());
    }

    let lower = stripped.to_ascii_lowercase();
    if lower.ends_with("\\windows") || lower.ends_with("\\program files") || lower.ends_with("\\program files (x86)") {
        return Err("Refusing to delete a protected system directory.".into());
    }

    let metadata = std::fs::metadata(&canon).map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        std::fs::remove_dir_all(&canon).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(&canon).map_err(|e| e.to_string())?;
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
//! walkdir-based universal scanner — works on all platforms without elevated
//! privileges.  Used as the default (and Phase 2 only) scan engine.

use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Sender,
        Arc,
    },
    time::UNIX_EPOCH,
};

use walkdir::WalkDir;

use crate::{
    models::{FileNode, NodeKind, ScanChunk, ScanError, ScanProgress},
    platform::Scanner,
};

// How many nodes to buffer before emitting a chunk.
const BATCH_SIZE: usize = 750;

pub struct UniversalScanner;

impl UniversalScanner {
    pub fn new() -> Self {
        UniversalScanner
    }
}

impl Scanner for UniversalScanner {
    fn scan(
        &self,
        path: &str,
        tx: Sender<ScanChunk>,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), ScanError> {
        let mut batch: Vec<FileNode> = Vec::with_capacity(BATCH_SIZE);
        let mut scanned: u64 = 0;
        let mut total_size: u64 = 0;
        let mut current_path = path.to_string();

        let walker = WalkDir::new(path)
            .follow_links(false)
            .same_file_system(false);

        for entry in walker {
            // Check cancellation each iteration.
            if cancel.load(Ordering::Relaxed) {
                return Err(ScanError::Cancelled);
            }

            let entry = match entry {
                Ok(e) => e,
                Err(err) => {
                    // Permission errors are silently skipped per architecture rules.
                    eprintln!("[dusk/scan] skipped: {err}");
                    continue;
                }
            };

            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(err) => {
                    eprintln!("[dusk/scan] metadata error: {err}");
                    continue;
                }
            };

            let abs_path = entry.path().to_string_lossy().to_string();
            current_path = abs_path.clone();

            let kind = if meta.is_dir() {
                NodeKind::Dir
            } else {
                NodeKind::File
            };

            let size = if meta.is_file() { meta.len() } else { 0 };
            total_size = total_size.saturating_add(size);
            scanned += 1;

            let name = entry
                .file_name()
                .to_string_lossy()
                .to_string();

            let extension = if meta.is_file() {
                entry
                    .path()
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
            } else {
                None
            };

            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);

            let node = FileNode {
                id: hash_path(&abs_path),
                name,
                path: abs_path,
                size,
                kind,
                extension,
                children: None, // flat stream; tree is rebuilt on the frontend
                modified,
            };

            batch.push(node);

            if batch.len() >= BATCH_SIZE {
                let chunk = ScanChunk {
                    nodes: std::mem::take(&mut batch),
                    progress: ScanProgress {
                        scanned,
                        total_size,
                        current_path: current_path.clone(),
                        done: false,
                    },
                };
                // If the receiver dropped (window closed), stop gracefully.
                if tx.send(chunk).is_err() {
                    return Ok(());
                }
                batch = Vec::with_capacity(BATCH_SIZE);
            }
        }

        // Flush remaining nodes with done = true.
        let _ = tx.send(ScanChunk {
            nodes: batch,
            progress: ScanProgress {
                scanned,
                total_size,
                current_path,
                done: true,
            },
        });

        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Generates a hex-encoded SipHash of `path` for use as a node ID.
fn hash_path(path: &str) -> String {
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    format!("{:016x}", h.finish())
}

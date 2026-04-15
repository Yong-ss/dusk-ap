use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Sender,
        Arc,
    },
    time::Instant,
};

use crate::{
    models::{FileNode, MftCache, NodeKind, ScanChunk, ScanError, ScanProgress},
    platform::Scanner,
};

const BATCH_SIZE: usize = 5000;

pub struct WalkdirScanner;

impl WalkdirScanner {
    pub fn new() -> Self {
        WalkdirScanner
    }
}

struct Entry {
    id: u64,
    name: String,
    path: String,
    parent_id: Option<u64>,
    size: u64,
    kind: NodeKind,
    children: Vec<usize>,
}

impl Scanner for WalkdirScanner {
    fn scan(
        &self,
        path: &str,
        scan_id: String,
        tx: Sender<ScanChunk>,
        cancel: Arc<AtomicBool>,
        _cache: Arc<tokio::sync::RwLock<Option<MftCache>>>,
    ) -> Result<(), ScanError> {
        let start = Instant::now();
        let root_path = Path::new(path);

        if !root_path.exists() {
            return Err(ScanError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Path does not exist: {}", path),
            )));
        }

        let mut entries: Vec<Entry> = Vec::new();
        let mut next_id: u64 = 0;

        let root_name = root_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());

        entries.push(Entry {
            id: next_id,
            name: root_name,
            path: path.to_string(),
            parent_id: None,
            size: 0,
            kind: NodeKind::Dir,
            children: Vec::new(),
        });
        next_id += 1;

        // BFS to collect all entries
        let mut queue_head: usize = 0;
        let mut scanned: u64 = 0;

        // queue_head walks through entries (which only contains dirs we need to expand)
        // We process entry at queue_head, read its children, append them to entries
        while queue_head < entries.len() {
            if cancel.load(Ordering::Relaxed) {
                return Err(ScanError::Cancelled);
            }

            if entries[queue_head].kind != NodeKind::Dir {
                queue_head += 1;
                continue;
            }

            let dir_path = entries[queue_head].path.clone();
            let dir_id = entries[queue_head].id;
            let dir_idx = queue_head;
            queue_head += 1;

            let read_dir = match fs::read_dir(&dir_path) {
                Ok(rd) => rd,
                Err(_) => continue,
            };

            for entry_result in read_dir {
                if cancel.load(Ordering::Relaxed) {
                    return Err(ScanError::Cancelled);
                }

                let entry = match entry_result {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                let child_path = entry.path().to_string_lossy().to_string();
                let child_name = entry.file_name().to_string_lossy().to_string();
                let is_dir = meta.is_dir();
                let size = if is_dir { 0 } else { meta.len() };
                let child_id = next_id;
                next_id += 1;

                let child_idx = entries.len();
                entries.push(Entry {
                    id: child_id,
                    name: child_name,
                    path: child_path,
                    parent_id: Some(dir_id),
                    size,
                    kind: if is_dir { NodeKind::Dir } else { NodeKind::File },
                    children: Vec::new(),
                });
                entries[dir_idx].children.push(child_idx);
                scanned += 1;
            }
        }

        // Propagate sizes bottom-up: children always have higher indices than parents
        for i in (0..entries.len()).rev() {
            if entries[i].kind == NodeKind::Dir {
                let child_sum: u64 = entries[i].children.iter().map(|&ci| entries[ci].size).sum();
                entries[i].size = child_sum;
            }
        }

        let total_size = entries[0].size;

        // Send root
        tx.send(ScanChunk {
            scan_id: scan_id.clone(),
            nodes: vec![FileNode {
                id: entries[0].id.to_string(),
                name: entries[0].name.clone(),
                path: entries[0].path.clone(),
                parent_id: None,
                size: total_size,
                kind: NodeKind::Dir,
                extension: None,
                children: None,
                modified: None,
            }],
            progress: ScanProgress {
                scanned,
                total_size,
                current_path: path.to_string(),
                done: false,
                total_records: None,
                processed_records: None,
            },
        }).ok();

        // Stream directories in batches
        let mut batch: Vec<FileNode> = Vec::new();
        for entry in &entries[1..] {
            if entry.kind == NodeKind::Dir {
                batch.push(FileNode {
                    id: entry.id.to_string(),
                    name: entry.name.clone(),
                    path: entry.path.clone(),
                    parent_id: entry.parent_id.map(|p| p.to_string()),
                    size: entry.size,
                    kind: NodeKind::Dir,
                    extension: None,
                    children: None,
                    modified: None,
                });

                if batch.len() >= BATCH_SIZE {
                    tx.send(ScanChunk {
                        scan_id: scan_id.clone(),
                        nodes: std::mem::take(&mut batch),
                        progress: ScanProgress {
                            scanned,
                            total_size,
                            current_path: String::new(),
                            done: false,
                            total_records: None,
                            processed_records: None,
                        },
                    }).ok();
                }
            }
        }

        // Final chunk
        tx.send(ScanChunk {
            scan_id: scan_id.clone(),
            nodes: batch,
            progress: ScanProgress {
                scanned,
                total_size,
                current_path: path.to_string(),
                done: true,
                total_records: None,
                processed_records: None,
            },
        }).ok();

        eprintln!(
            "[dusk/walkdir] Scan complete: {} items, {} bytes, {:.2?}",
            scanned, total_size, start.elapsed()
        );

        Ok(())
    }
}

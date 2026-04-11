#![cfg(windows)]

use std::{
    collections::{HashMap, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Sender,
        Arc,
    },
    os::windows::io::FromRawHandle,
    fs::File,
    path::Path,
};

use binrw::io::{Read, Seek, SeekFrom};
use ntfs::Ntfs;
use windows::{
    core::HSTRING,
    Win32::Foundation::INVALID_HANDLE_VALUE,
    Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_ACCESS_RIGHTS,
    },
};

use crate::{
    models::{FileNode, NodeKind, ScanChunk, ScanError, ScanProgress},
    platform::Scanner,
};

const BATCH_SIZE: usize = 750;

// Internal metadata for MFT entries before path resolution
#[derive(Debug)]
struct MftEntry {
    name: String,
    parent_id: u64,
    size: u64,
    kind: NodeKind,
    extension: Option<String>,
}

/// A reader wrapper that ensures all underlying IO is sector-aligned.
/// Necessary for Windows raw volume handles (\\.\C:) which return
/// OS Error 87 (The parameter is incorrect) on unaligned offsets/lengths.
struct SectorAlignedReader<R: Read + Seek> {
    inner: R,
    sector_size: u64,
    buffer: Vec<u8>,
    buffer_start: u64, // absolute offset of what's in buffer
    current_pos: u64,  // logical position
}

impl<R: Read + Seek> SectorAlignedReader<R> {
    fn new(inner: R, sector_size: u64) -> Self {
        Self {
            inner,
            sector_size,
            buffer: vec![0u8; sector_size as usize * 8], // 4KB buffer
            buffer_start: u64::MAX,
            current_pos: 0,
        }
    }

    fn fill_buffer(&mut self, pos: u64) -> io::Result<()> {
        let aligned_start = (pos / self.sector_size) * self.sector_size;
        self.inner.seek(SeekFrom::Start(aligned_start))?;
        self.inner.read_exact(&mut self.buffer)?;
        self.buffer_start = aligned_start;
        Ok(())
    }
}

impl<R: Read + Seek> Read for SectorAlignedReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let mut total_read = 0;
        while total_read < buf.len() {
            let pos = self.current_pos;
            
            // If current pos is not in buffer, fill it
            if self.buffer_start == u64::MAX 
                || pos < self.buffer_start 
                || pos >= self.buffer_start + self.buffer.len() as u64 
            {
                self.fill_buffer(pos)?;
            }

            let offset_in_buffer = (pos - self.buffer_start) as usize;
            let available = self.buffer.len() - offset_in_buffer;
            let to_copy = std::cmp::min(buf.len() - total_read, available);
            
            buf[total_read..total_read + to_copy].copy_from_slice(&self.buffer[offset_in_buffer..offset_in_buffer + to_copy]);
            
            total_read += to_copy;
            self.current_pos += to_copy as u64;
        }
        Ok(total_read)
    }
}

impl<R: Read + Seek> Seek for SectorAlignedReader<R> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        match pos {
            SeekFrom::Start(p) => self.current_pos = p,
            SeekFrom::Current(p) => self.current_pos = (self.current_pos as i64 + p) as u64,
            SeekFrom::End(_) => return Err(io::Error::new(io::ErrorKind::Unsupported, "Seek from end not supported on raw volumes")),
        }
        Ok(self.current_pos)
    }
}

pub struct WindowsMftScanner;

impl WindowsMftScanner {
    pub fn new() -> Self {
        WindowsMftScanner
    }
}

impl Scanner for WindowsMftScanner {
    fn scan(
        &self,
        path: &str,
        tx: Sender<ScanChunk>,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), ScanError> {
        let drive_letter = path.chars().next().unwrap_or('C');
        let vol_path = format!("\\\\.\\{}:", drive_letter);
        
        let access = FILE_ACCESS_RIGHTS(0x80000000u32); // GENERIC_READ
        let handle = unsafe {
            CreateFileW(
                &HSTRING::from(vol_path.clone()),
                access.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                None,
            )
        }.map_err(|e| ScanError::Io(io::Error::new(io::ErrorKind::Other, e.to_string())))?;

        if handle.is_invalid() || handle.0 == INVALID_HANDLE_VALUE.0 {
            return Err(ScanError::Permission(format!("Failed to open volume {}. Run as administrator.", vol_path)));
        }

        let handle = unsafe {
            File::from_raw_handle(handle.0 as _)
        };

        let mut reader = SectorAlignedReader::new(handle, 512);

        let ntfs = Ntfs::new(&mut reader)
            .map_err(|e| ScanError::Io(io::Error::new(io::ErrorKind::InvalidData, e.to_string())))?;
        
        // We need the root MFT file to calculate total records
        let mft_file = ntfs.file(&mut reader, 0)
            .map_err(|e| ScanError::Io(io::Error::new(io::ErrorKind::InvalidData, format!("Failed to fetch $MFT: {}", e))))?;
        
        let mft_data_item = mft_file.data(&mut reader, "")
            .ok_or_else(|| ScanError::Io(io::Error::new(io::ErrorKind::InvalidData, "MFT has no $DATA")))?
            .map_err(|e| ScanError::Io(io::Error::new(io::ErrorKind::InvalidData, e.to_string())))?;
            
        let mft_attribute = mft_data_item.to_attribute()
            .map_err(|e| ScanError::Io(io::Error::new(io::ErrorKind::InvalidData, e.to_string())))?;

        let mft_size = mft_attribute.value_length();
        let record_size = ntfs.file_record_size() as u64;
        let total_records = mft_size / record_size;

        let mut flat_entries: HashMap<u64, MftEntry> = HashMap::with_capacity(total_records as usize / 2);
        
        for i in 0..total_records {
            if i % 5000 == 0 && cancel.load(Ordering::Relaxed) {
                return Err(ScanError::Cancelled);
            }

            let file = match ntfs.file(&mut reader, i) {
                Ok(f) => f,
                Err(_) => continue,
            };

            if !file.flags().contains(ntfs::NtfsFileFlags::IN_USE) {
                continue;
            }

            let mut is_reparse = false;
            for attr in file.attributes_raw() {
                if let Ok(a) = attr {
                    if let Ok(ty) = a.ty() {
                         if ty == ntfs::NtfsAttributeType::ReparsePoint {
                             is_reparse = true;
                             break;
                         }
                    }
                }
            }
            if is_reparse { continue; }

            let is_dir = file.is_directory();
            
            let name_attr_result = file.name(&mut reader, None, None);
            let (name, parent_id) = match name_attr_result {
                Some(Ok(fn_attr)) => {
                    let name_str = fn_attr.name().to_string().unwrap_or_else(|_| "Unknown".to_string());
                    (name_str, fn_attr.parent_directory_reference().file_record_number())
                },
                _ => continue,
            };

            let mut size = 0u64;
            if !is_dir {
                if let Some(Ok(data_item)) = file.data(&mut reader, "") {
                    if let Ok(attr) = data_item.to_attribute() {
                        size = attr.value_length();
                    }
                }
            }

            let extension = if !is_dir {
                Path::new(&name)
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
            } else {
                None
            };

            flat_entries.insert(i, MftEntry {
                name,
                parent_id,
                size,
                kind: if is_dir { NodeKind::Dir } else { NodeKind::File },
                extension,
            });
        }

        let mut batch: Vec<FileNode> = Vec::with_capacity(BATCH_SIZE);
        let mut scanned_count = 0u64;
        let mut current_total_size = 0u64;

        let mut hierarchy: HashMap<u64, Vec<u64>> = HashMap::with_capacity(flat_entries.len());
        for (&id, entry) in &flat_entries {
            hierarchy.entry(entry.parent_id).or_default().push(id);
        }

        let mut path_cache: HashMap<u64, String> = HashMap::with_capacity(flat_entries.len());
        path_cache.insert(5, path.trim_end_matches(['/', '\\']).to_string());

        let mut queue = vec![5u64];
        while let Some(parent_id) = queue.pop() {
            if cancel.load(Ordering::Relaxed) { return Err(ScanError::Cancelled); }

            let children = match hierarchy.get(&parent_id) {
                Some(c) => c,
                None => continue,
            };

            let parent_path = path_cache.get(&parent_id).cloned().unwrap_or_else(|| path.to_string());

            for &child_id in children {
                if child_id == parent_id { continue; }

                if let Some(entry) = flat_entries.get(&child_id) {
                    let full_path = format!("{}\\{}", parent_path, entry.name);
                    path_cache.insert(child_id, full_path.clone());
                    
                    scanned_count += 1;
                    current_total_size += entry.size;

                    batch.push(FileNode {
                        id: hash_path(&full_path),
                        name: entry.name.clone(),
                        path: full_path.clone(),
                        size: entry.size,
                        kind: entry.kind.clone(),
                        extension: entry.extension.clone(),
                        children: None,
                        modified: None,
                    });

                    if entry.kind == NodeKind::Dir {
                        queue.push(child_id);
                    }

                    if batch.len() >= BATCH_SIZE {
                        tx.send(ScanChunk {
                            nodes: std::mem::take(&mut batch),
                            progress: ScanProgress {
                                scanned: scanned_count,
                                total_size: current_total_size,
                                current_path: full_path,
                                done: false,
                            },
                        }).ok();
                    }
                }
            }
        }

        // Final Flush
        tx.send(ScanChunk {
            nodes: batch,
            progress: ScanProgress {
                scanned: scanned_count,
                total_size: current_total_size,
                current_path: path.to_string(),
                done: true,
            },
        }).ok();

        Ok(())
    }
}

fn hash_path(path: &str) -> String {
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    format!("{:16x}", h.finish())
}

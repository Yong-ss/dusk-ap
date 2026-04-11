use std::{
    collections::{HashMap},
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Sender,
        Arc,
    },
    time::Instant,
};

use windows::{
    core::HSTRING,
    Win32::Foundation::{INVALID_HANDLE_VALUE, HANDLE},
    Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS, ReadFile,
        FILE_FLAG_NO_BUFFERING, FILE_FLAG_SEQUENTIAL_SCAN,
    },
    Win32::System::Memory::{
        VirtualAlloc, VirtualFree, 
        MEM_COMMIT, MEM_RESERVE, MEM_RELEASE, 
        PAGE_READWRITE,
    },
};

use rayon::prelude::*;

use crate::{
    models::{FileNode, NodeKind, ScanChunk, ScanError, ScanProgress},
    platform::Scanner,
};

const BATCH_SIZE: usize = 15000;
const SECTOR_SIZE_ALIGN: u64 = 4096;

#[derive(Debug, Clone)]
struct MftEntry {
    name: String,
    parent_id: u64,
    size: u64,
    kind: NodeKind,
}

struct AlignedBuffer {
    ptr: *mut u8,
    size: usize,
}

impl AlignedBuffer {
    fn new(size: usize) -> io::Result<Self> {
        let aligned_size = (size + SECTOR_SIZE_ALIGN as usize - 1) & !(SECTOR_SIZE_ALIGN as usize - 1);
        let ptr = unsafe {
            VirtualAlloc(None, aligned_size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE)
        } as *mut u8;
        
        if ptr.is_null() {
            Err(io::Error::last_os_error())
        } else {
            Ok(Self { ptr, size: aligned_size })
        }
    }

    fn as_slice(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.ptr, self.size) }
    }

    fn as_mut_slice(&mut self) -> &mut [u8] {
        unsafe { std::slice::from_raw_parts_mut(self.ptr, self.size) }
    }
}

unsafe impl Send for AlignedBuffer {}
unsafe impl Sync for AlignedBuffer {}

impl Drop for AlignedBuffer {
    fn drop(&mut self) {
        unsafe {
            let _ = VirtualFree(self.ptr as _, 0, MEM_RELEASE);
        }
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
        let global_start = Instant::now();
        let drive_letter = path.chars().next().unwrap_or('C');
        let vol_path = format!("\\\\.\\{}:", drive_letter);
        
        let handle = unsafe {
            CreateFileW(
                &HSTRING::from(vol_path.clone()),
                0x80000000u32, // GENERIC_READ
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_NO_BUFFERING | FILE_FLAG_SEQUENTIAL_SCAN,
                None,
            )
        }.map_err(|e| ScanError::Io(io::Error::other(e.to_string())))?;

        if handle.is_invalid() || handle.0 == INVALID_HANDLE_VALUE.0 {
            return Err(ScanError::Permission(format!("Failed to open volume {} with Direct I/O. Run as administrator.", vol_path)));
        }

        // ── Phase 0: Boot Sector ───────────────────────────────────────────
        let mut boot_buffer = AlignedBuffer::new(4096)?;
        read_at(handle, 0, boot_buffer.as_mut_slice())?;
        
        let boot_sector = boot_buffer.as_slice();
        let bytes_per_sector = u16::from_le_bytes([boot_sector[0x0B], boot_sector[0x0C]]) as u64;
        let sectors_per_cluster = boot_sector[0x0D] as u64;
        let bytes_per_cluster = bytes_per_sector * sectors_per_cluster;
        let mft_lcn = u64::from_le_bytes(boot_sector[0x30..0x38].try_into().unwrap());
        
        let mft_record_size_val = boot_sector[0x40] as i8;
        let mft_record_size = if mft_record_size_val > 0 {
            mft_record_size_val as u64 * bytes_per_cluster
        } else {
            2u64.pow((-mft_record_size_val) as u32)
        };

        // ── Phase 1: MFT Bounds ────────────────────────────────────────────
        let mft_start_offset = mft_lcn * bytes_per_cluster;
        let mut mft0_buffer = AlignedBuffer::new(4096)?;
        read_at(handle, mft_start_offset, mft0_buffer.as_mut_slice())?;

        let mft_record0 = &mut mft0_buffer.as_mut_slice()[0..mft_record_size as usize];
        apply_fixups(mft_record0, bytes_per_sector as usize);

        let data_runs = get_data_runs(mft_record0)?;
        let mut total_mft_size = 0u64;
        for (clusters, _) in &data_runs {
            total_mft_size += clusters * bytes_per_cluster;
        }

        // ── Phase 2: DMA Engine ────────────────────────────────────────────
        let read_start = Instant::now();
        let mut mft_buffer = AlignedBuffer::new(total_mft_size as usize)?;
        let mut buffer_offset = 0;
        let mut current_lcn = 0i64;

        for (count, lcn_delta) in data_runs {
            current_lcn += lcn_delta;
            let run_offset = current_lcn as u64 * bytes_per_cluster;
            let run_size = count * bytes_per_cluster;
            read_at(handle, run_offset, &mut mft_buffer.as_mut_slice()[buffer_offset..buffer_offset + run_size as usize])?;
            buffer_offset += run_size as usize;
        }
        let read_elapsed = read_start.elapsed();

        // ── Phase 3: High-Speed Parallel Parse ─────────────────────────────
        let parse_start = Instant::now();
        let total_records = total_mft_size / mft_record_size;
        
        let mut flat_entries: HashMap<u64, MftEntry> = mft_buffer.as_mut_slice()
            .par_chunks_mut(mft_record_size as usize)
            .enumerate()
            .filter_map(|(enum_i, record)| {
                let i = enum_i as u64;
                if cancel.load(Ordering::Relaxed) { return None; }
                
                if record.len() < 42 || &record[0..4] != b"FILE" { return None; }
                if i < 24 { return None; }

                let flags = u16::from_le_bytes([record[22], record[23]]);
                if flags & 0x0001 == 0 { return None; }
                let is_dir = (flags & 0x0002) != 0;

                apply_fixups(record, bytes_per_sector as usize);

                // Offset to first attribute is at 0x14 (20 dec)
                let mut attr_offset = u16::from_le_bytes([record[20], record[21]]) as usize;
                let mut name: Option<String> = None;
                let mut parent_id: u64 = 0;
                let mut data_size: u64 = 0;
                let mut has_file_name_attr = false;

                while attr_offset + 8 < mft_record_size as usize {
                    let attr_type = u32::from_le_bytesByRef(&record[attr_offset..attr_offset+4]);
                    if attr_type == 0xFFFFFFFF { break; }
                    let attr_len = u32::from_le_bytesByRef(&record[attr_offset+4..attr_offset+8]) as usize;
                    if attr_len < 24 || attr_offset + attr_len > mft_record_size as usize { break; }

                    match attr_type {
                        0x30 => { // $FILE_NAME
                            let res_offset = u16::from_le_bytes([record[attr_offset+20], record[attr_offset+21]]) as usize;
                            let val_start = attr_offset + res_offset;
                            if val_start + 66 < mft_record_size as usize {
                                let namespace = record[val_start + 65];
                                if namespace == 2 {
                                    attr_offset += attr_len;
                                    continue;
                                }
                                has_file_name_attr = true;
                                let mut pid_bytes = [0u8; 8];
                                pid_bytes[0..6].copy_from_slice(&record[val_start..val_start+6]);
                                parent_id = u64::from_le_bytes(pid_bytes);

                                let name_len = record[val_start + 64] as usize;
                                let name_ptr = val_start + 66;
                                if name_ptr + (name_len * 2) <= mft_record_size as usize {
                                    let mut utf16_data = Vec::with_capacity(name_len);
                                    for j in 0..name_len {
                                        utf16_data.push(u16::from_le_bytes([record[name_ptr + j*2], record[name_ptr + j*2 + 1]]));
                                    }
                                    let n = String::from_utf16_lossy(&utf16_data);
                                    if !n.is_empty() && !n.starts_with('$') {
                                        name = Some(n);
                                    }
                                }
                            }
                        },
                        0x80 => { // $DATA
                            let name_len = record[attr_offset + 9];
                            if name_len == 0 {
                                let is_non_resident = record[attr_offset + 8] != 0;
                                if is_non_resident {
                                    if attr_offset + 64 <= mft_record_size as usize {
                                        // REAL SIZE is at offset 0x38 (56 dec)
                                        data_size = u64::from_le_bytesByRef(&record[attr_offset+56..attr_offset+64]);
                                    }
                                } else {
                                    // RESIDENT VALUE LENGTH is at offset 0x10 (16 dec)
                                    if attr_offset + 24 <= mft_record_size as usize {
                                        data_size = u32::from_le_bytesByRef(&record[attr_offset+16..attr_offset+20]) as u64;
                                    }
                                }
                            }
                        },
                        _ => {}
                    }
                    attr_offset += attr_len;
                }

                if !has_file_name_attr { return None; }
                if let Some(n) = name {
                    Some((i, MftEntry {
                        name: n,
                        parent_id,
                        size: data_size,
                        kind: if is_dir { NodeKind::Dir } else { NodeKind::File },
                    }))
                } else {
                    None
                }
            }).collect();
        let parse_elapsed = parse_start.elapsed();

        // ── Phase 4: Ultimate Array-Based Aggregation ──────────────────────
        let aggregate_start = Instant::now();
        let max_id = flat_entries.keys().cloned().max().unwrap_or(0) as usize;
        
        // Use flat Vecs for O(1) indexing performance
        let mut entry_sizes = vec![0u64; max_id + 1];
        let mut parent_ids = vec![0u64; max_id + 1];
        let mut child_counts = vec![0u32; max_id + 1];
        let mut kind_is_dir = vec![false; max_id + 1];

        for (&id, entry) in &flat_entries {
            let idx = id as usize;
            entry_sizes[idx] = entry.size;
            parent_ids[idx] = entry.parent_id;
            kind_is_dir[idx] = entry.kind == NodeKind::Dir;
            
            let pid = entry.parent_id as usize;
            if pid <= max_id && pid != idx {
                child_counts[pid] += 1;
            }
        }

        // Topological Sort (Leaf-to-Root) propagation
        let mut leaf_queue = Vec::with_capacity(flat_entries.len());
        for (&id, _) in &flat_entries {
            if child_counts[id as usize] == 0 {
                leaf_queue.push(id);
            }
        }

        let mut head = 0;
        while head < leaf_queue.len() {
            let cid = leaf_queue[head];
            head += 1;

            let c_idx = cid as usize;
            let pid = parent_ids[c_idx];
            let p_idx = pid as usize;

            if pid != cid && pid <= max_id as u64 && pid > 0 {
                let c_size = entry_sizes[c_idx];
                entry_sizes[p_idx] += c_size;
                
                child_counts[p_idx] -= 1;
                if child_counts[p_idx] == 0 {
                    leaf_queue.push(pid);
                }
            }
        }

        // Apply pre-computed sizes back to flat_entries
        for (id, entry) in flat_entries.iter_mut() {
            entry.size = entry_sizes[*id as usize];
        }
        let aggregate_elapsed = aggregate_start.elapsed();

        // ── Phase 5: Saturation BFS Stream ─────────────────────────────────
        let stream_start = Instant::now();
        let mut hierarchy: HashMap<u64, Vec<u64>> = HashMap::with_capacity(flat_entries.len());
        for (&id, entry) in &flat_entries {
            hierarchy.entry(entry.parent_id).or_default().push(id);
        }

        let base_path = path.trim_end_matches(['/', '\\']).to_string();
        let mut path_cache: HashMap<u64, String> = HashMap::with_capacity(flat_entries.len() / 5);
        path_cache.insert(5, base_path.clone());

        let mut batch: Vec<FileNode> = Vec::with_capacity(BATCH_SIZE);
        let mut scanned_count = 0u64;
        let mut total_disk_size = 0u64;

        let mut debug_count = 0;
        let mut queue = vec![5u64];
        while let Some(pid) = queue.pop() {
            if cancel.load(Ordering::Relaxed) { return Err(ScanError::Cancelled); }
            let children = match hierarchy.get(&pid) {
                Some(c) => c,
                None => continue,
            };
            
            let p_path = path_cache.get(&pid).cloned().unwrap_or_else(|| base_path.clone());

            for &cid in children {
                if cid == pid { continue; }
                if let Some(entry) = flat_entries.get(&cid) {
                    scanned_count += 1;
                    if entry.kind == NodeKind::File {
                        total_disk_size += entry.size;
                        if debug_count < 10 && entry.size > 0 {
                            eprintln!("[DEBUG] Found File: {} | Size: {} bytes", entry.name, entry.size);
                            debug_count += 1;
                        }
                    }

                    if entry.kind == NodeKind::Dir {
                        let full_path = format!("{}\\{}", p_path, entry.name);
                        path_cache.insert(cid, full_path);
                        queue.push(cid);
                    }

                    batch.push(FileNode {
                        id: cid.to_string(),
                        name: entry.name.clone(),
                        path: String::new(), 
                        parent_id: Some(pid.to_string()),
                        size: entry.size, 
                        kind: entry.kind.clone(),
                        extension: std::path::Path::new(&entry.name).extension()
                            .map(|e| e.to_string_lossy().to_lowercase()),
                        children: None,
                        modified: None,
                    });

                    if batch.len() >= BATCH_SIZE {
                        tx.send(ScanChunk {
                            nodes: std::mem::take(&mut batch),
                            progress: ScanProgress {
                                scanned: scanned_count,
                                total_size: total_disk_size,
                                current_path: format!("Deploying: {}", entry.name),
                                done: false,
                                total_records: Some(total_records),
                                processed_records: Some(total_records),
                            },
                        }).ok();
                    }
                }
            }
        }
        let stream_elapsed = stream_start.elapsed();

        eprintln!("\n[WIZTREE RIVAL ULTIMATE BREAKDOWN]");
        eprintln!("- Volume: {}", vol_path);
        eprintln!("- Phase 2 (Read):      {:? }", read_elapsed);
        eprintln!("- Phase 3 (Parse):     {:? }", parse_elapsed);
        eprintln!("- Phase 4 (Array Agg): {:? }", aggregate_elapsed);
        eprintln!("- Phase 5 (Stream):    {:? }", stream_elapsed);
        eprintln!("- TOTAL BACKEND: {:?}", global_start.elapsed());
        eprintln!("- Final Nodes: {}\n", scanned_count);

        tx.send(ScanChunk {
            nodes: batch,
            progress: ScanProgress {
                scanned: scanned_count,
                total_size: total_disk_size,
                current_path: path.to_string(),
                done: true,
                total_records: Some(total_records),
                processed_records: Some(total_records),
              },
        }).ok();

        Ok(())
    }
}

trait LeBytesExt {
    fn from_le_bytesByRef(bytes: &[u8]) -> Self;
}

impl LeBytesExt for u32 {
    fn from_le_bytesByRef(bytes: &[u8]) -> Self {
        u32::from_le_bytes(bytes[0..4].try_into().unwrap())
    }
}

impl LeBytesExt for u64 {
    fn from_le_bytesByRef(bytes: &[u8]) -> Self {
        u64::from_le_bytes(bytes[0..8].try_into().unwrap())
    }
}

fn read_at(handle: HANDLE, offset: u64, buf: &mut [u8]) -> io::Result<()> {
    unsafe {
        let mut overlapped = std::mem::zeroed::<windows::Win32::System::IO::OVERLAPPED>();
        overlapped.Anonymous.Anonymous.Offset = (offset & 0xFFFFFFFF) as u32;
        overlapped.Anonymous.Anonymous.OffsetHigh = (offset >> 32) as u32;
        ReadFile(handle, Some(buf), None, Some(&mut overlapped))
            .map_err(|e| io::Error::other(e.to_string()))
    }
}

fn apply_fixups(record: &mut [u8], sector_size: usize) {
    if record.len() < 8 { return; }
    let fixup_offset = u16::from_le_bytes([record[4], record[5]]) as usize;
    let fixup_count = u16::from_le_bytes([record[6], record[7]]) as usize;
    if fixup_count <= 1 || fixup_offset + (fixup_count * 2) > record.len() { return; }

    let pattern = [record[fixup_offset], record[fixup_offset + 1]];
    for j in 1..fixup_count {
        let sector_end = j * sector_size - 2;
        if record[sector_end] == pattern[0] && record[sector_end + 1] == pattern[1] {
            let entry_offset = fixup_offset + j * 2;
            record[sector_end] = record[entry_offset];
            record[sector_end + 1] = record[entry_offset + 1];
        }
    }
}

fn get_data_runs(record: &[u8]) -> Result<Vec<(u64, i64)>, ScanError> {
    if record.len() < 0x16 { return Err(ScanError::Io(io::Error::new(io::ErrorKind::InvalidData, "Invalid MFT record header"))); }
    let mut attr_offset = u16::from_le_bytes([record[0x14], record[0x15]]) as usize;
    let record_len = record.len();

    while attr_offset + 8 < record_len {
        let attr_type = u32::from_le_bytesByRef(&record[attr_offset..attr_offset+4]);
        if attr_type == 0xFFFFFFFF { break; }
        let attr_len = u32::from_le_bytesByRef(&record[attr_offset+4..attr_offset+8]) as usize;
        if attr_len < 8 || attr_offset + attr_len > record_len { break; }
        
        let is_non_resident = record[attr_offset + 8] != 0;
        if attr_type == 0x80 && is_non_resident {
            let runs_offset = u16::from_le_bytes([record[attr_offset+32], record[attr_offset+33]]) as usize;
            let mut ptr = attr_offset + runs_offset;
            let mut runs = Vec::new();
            while ptr < attr_offset + attr_len {
                let header = record[ptr];
                if header == 0 { break; }
                ptr += 1;
                let len_size = (header & 0x0F) as usize;
                let off_size = (header >> 4) as usize;
                if ptr + len_size + off_size > attr_offset + attr_len { break; }
                let mut count = 0u64;
                for i in 0..len_size { count |= (record[ptr + i] as u64) << (i * 8); }
                ptr += len_size;
                let mut offset_delta = 0i64;
                for i in 0..off_size { offset_delta |= (record[ptr + i] as i64) << (i * 8); }
                if off_size > 0 && (record[ptr + off_size - 1] & 0x80) != 0 {
                    for i in off_size..8 { offset_delta |= 0xFFi64 << (i * 8); }
                }
                ptr += off_size;
                runs.push((count, offset_delta));
            }
            return Ok(runs);
        }
        attr_offset += attr_len;
    }
    Err(ScanError::Io(io::Error::new(io::ErrorKind::InvalidData, "$DATA runs not found")))
}

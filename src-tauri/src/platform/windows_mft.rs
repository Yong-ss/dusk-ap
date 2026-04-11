use std::{
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

        // ── Phase 0: Boot Sector ──────────────────────────────────────
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

        // ── Phase 1: Read MFT Bounds ──────────────────────────────────
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

        // ── Phase 2: DMA Engine ──────────────────────────────────────
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

        // ── Phase 3: High-Speed Parallel Parse ────────────────────────
        let parse_start = Instant::now();
        let total_records = total_mft_size / mft_record_size;
        
        // Zero-HashMap: Collect into indexed vector
        let raw_entries: Vec<Option<MftEntry>> = mft_buffer.as_mut_slice()
            .par_chunks_mut(mft_record_size as usize)
            .enumerate()
            .map(|(enum_i, record)| {
                let i = enum_i as u64;
                if cancel.load(Ordering::Relaxed) { return None; }
                
                if record.len() < 42 || &record[0..4] != b"FILE" { return None; }
                
                // Allow record 5 (root)
                if i < 24 && i != 5 { return None; }

                let flags = u16::from_le_bytes([record[22], record[23]]);
                if flags & 0x0001 == 0 { return None; }
                let is_dir = (flags & 0x0002) != 0;

                apply_fixups(record, bytes_per_sector as usize);

                let mut attr_offset = u16::from_le_bytes([record[20], record[21]]) as usize;
                let mut name: Option<String> = None;
                let mut parent_id: u64 = 0;
                let mut data_size: u64 = 0;
                let mut has_file_name_attr = false;

                while attr_offset + 8 < mft_record_size as usize {
                    let attr_type = u32::from_le_bytes_by_ref(&record[attr_offset..attr_offset+4]);
                    if attr_type == 0xFFFFFFFF { break; }
                    let attr_len = u32::from_le_bytes_by_ref(&record[attr_offset+4..attr_offset+8]) as usize;
                    if attr_len < 8 || attr_offset + attr_len > mft_record_size as usize { break; }

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
                                        // Real Size at 0x30 (48 dec)
                                        data_size = u64::from_le_bytes_by_ref(&record[attr_offset+48..attr_offset+56]);
                                    }
                                } else {
                                    if attr_offset + 24 <= mft_record_size as usize {
                                        data_size = u32::from_le_bytes_by_ref(&record[attr_offset+16..attr_offset+20]) as u64;
                                    }
                                }
                            }
                        },
                        _ => {}
                    }
                    attr_offset += attr_len;
                }

                if i == 5 {
                    return Some(MftEntry {
                        name: drive_letter.to_string() + ":",
                        parent_id: 0,
                        size: 0,
                        kind: NodeKind::Dir,
                    });
                }

                if !has_file_name_attr { return None; }
                if let Some(n) = name {
                    Some(MftEntry {
                        name: n,
                        parent_id,
                        size: data_size,
                        kind: if is_dir { NodeKind::Dir } else { NodeKind::File },
                    })
                } else {
                    None
                }
            }).collect();
        let parse_elapsed = parse_start.elapsed();

        // ── Phase 4: Topology Speed Vault (Array Only) ──────────────────
        let aggregate_start = Instant::now();
        let max_id = raw_entries.len();
        
        let mut entry_sizes = vec![0u64; max_id];
        let mut parent_ids = vec![0u64; max_id];
        let mut child_counts = vec![0u32; max_id];
        let mut hierarchy: Vec<Vec<u64>> = vec![vec![]; max_id];

        for (id_idx, entry_opt) in raw_entries.iter().enumerate() {
            if let Some(entry) = entry_opt {
                let id = id_idx as u64;
                entry_sizes[id_idx] = entry.size;
                parent_ids[id_idx] = entry.parent_id;
                
                let pid = entry.parent_id;
                if pid < max_id as u64 && pid != id {
                    child_counts[pid as usize] += 1;
                    hierarchy[pid as usize].push(id);
                }
            }
        }

        // Topological Sort for size propagation
        let mut leaf_queue = Vec::with_capacity(max_id);
        for i in 0..max_id {
            if raw_entries[i].is_some() && child_counts[i] == 0 {
                leaf_queue.push(i as u64);
            }
        }

        let mut head = 0;
        while head < leaf_queue.len() {
            let cid = leaf_queue[head];
            head += 1;

            let pid = parent_ids[cid as usize];
            if pid != cid && pid < max_id as u64 && pid > 0 {
                entry_sizes[pid as usize] += entry_sizes[cid as usize];
                child_counts[pid as usize] -= 1;
                if child_counts[pid as usize] == 0 {
                    leaf_queue.push(pid);
                }
            }
        }
        let aggregate_elapsed = aggregate_start.elapsed();

        // ── Phase 5: Virtual Tree Stream (Folder-First) ───────────────
        let stream_start = Instant::now();
        
        // Resolve Target Record ID from Path
        let path_parts: Vec<&str> = path.split(|c| c == '\\' || c == '/').filter(|s| !s.is_empty()).collect();
        let mut target_id = 5u64;
        
        if path_parts.len() > 1 {
            let mut current_id = 5u64;
            for i in 1..path_parts.len() {
                let part = path_parts[i];
                let mut found = false;
                for &cid in &hierarchy[current_id as usize] {
                    if let Some(entry) = &raw_entries[cid as usize] {
                        if entry.name.eq_ignore_ascii_case(part) {
                            current_id = cid;
                            found = true;
                            break;
                        }
                    }
                }
                if found {
                    target_id = current_id;
                } else {
                    target_id = 5; // Path broken or not found, fallback to root
                    break;
                }
            }
        }

        let root_name = if target_id == 5 {
            format!("{}:\\", drive_letter)
        } else {
            raw_entries[target_id as usize].as_ref().unwrap().name.clone()
        };

        let mut batch: Vec<FileNode> = Vec::with_capacity(BATCH_SIZE);
        let mut scanned_count = 0u64;
        let mut total_disk_size = 0u64;

        // BFS traversal starts ONLY at the target folder
        let mut queue = vec![target_id];
        
        // STAGE 1: Explicitly send root (Mask parent_id so Frontend anchors it as Tree Root)
        tx.send(ScanChunk {
            nodes: vec![FileNode {
                id: target_id.to_string(),
                name: root_name,
                path: path.to_string(),
                parent_id: None,
                size: entry_sizes[target_id as usize],
                kind: NodeKind::Dir,
                extension: None,
                children: None,
                modified: None,
            }],
            progress: ScanProgress {
                scanned: 1,
                total_size: 0,
                current_path: path.to_string(),
                done: false,
                total_records: Some(total_records),
                processed_records: Some(total_records),
            },
        }).ok();

        // STAGE 2: Stream Folders (Crucial for instant UI response)
        while let Some(pid) = queue.pop() {
            if cancel.load(Ordering::Relaxed) { return Err(ScanError::Cancelled); }
            let children = &hierarchy[pid as usize];

            for &cid in children {
                if let Some(entry) = &raw_entries[cid as usize] {
                    scanned_count += 1;
                    if entry.kind == NodeKind::File {
                        total_disk_size += entry.size;
                    }

                    if entry.kind == NodeKind::Dir {
                        queue.push(cid);
                        
                        // We ONLY push folders to the frontend stream to eliminate the 2.2M JSON object bottleneck. 
                        // The sizes are already aggregated so the folders show the right size.
                        batch.push(FileNode {
                            id: cid.to_string(),
                            name: entry.name.clone(),
                            path: String::new(), 
                            parent_id: Some(pid.to_string()),
                            size: entry_sizes[cid as usize], 
                            kind: entry.kind.clone(),
                            extension: None,
                            children: None,
                            modified: None,
                        });

                        if batch.len() >= BATCH_SIZE {
                            tx.send(ScanChunk {
                                nodes: std::mem::take(&mut batch),
                                progress: ScanProgress {
                                    scanned: scanned_count,
                                    total_size: total_disk_size,
                                    current_path: format!("Mapping: {}", entry.name),
                                    done: false,
                                    total_records: Some(total_records),
                                    processed_records: Some(total_records),
                                },
                            }).ok();
                        }
                    }
                }
            }
        }
        let stream_elapsed = stream_start.elapsed();

        eprintln!("\n[DUSK SATURATION ENGINE]");
        eprintln!("- Read DMA: {:? }", read_elapsed);
        eprintln!("- Parse:    {:? }", parse_elapsed);
        eprintln!("- Aggr:     {:? }", aggregate_elapsed);
        eprintln!("- Stream:   {:? }", stream_elapsed);
        eprintln!("- TOTAL:    {:?}", global_start.elapsed());
        eprintln!("- Objects:  {}\n", scanned_count);

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
    fn from_le_bytes_by_ref(bytes: &[u8]) -> Self;
}

impl LeBytesExt for u32 {
    fn from_le_bytes_by_ref(bytes: &[u8]) -> Self {
        u32::from_le_bytes(bytes[0..4].try_into().unwrap())
    }
}

impl LeBytesExt for u64 {
    fn from_le_bytes_by_ref(bytes: &[u8]) -> Self {
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
        let attr_type = u32::from_le_bytes_by_ref(&record[attr_offset..attr_offset+4]);
        if attr_type == 0xFFFFFFFF { break; }
        let attr_len = u32::from_le_bytes_by_ref(&record[attr_offset+4..attr_offset+8]) as usize;
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

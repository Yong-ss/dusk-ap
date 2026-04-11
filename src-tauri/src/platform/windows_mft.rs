//! Windows MFT direct-parse scanner — Phase 8 stub.
//!
//! This file compiles on all platforms but is only instantiated on Windows via
//! the factory in `platform/mod.rs`.  The real MFT implementation (ntfs crate +
//! Win32 FSCTL) will replace the body of `scan()` in Phase 8.

use std::sync::{atomic::AtomicBool, mpsc::Sender, Arc};

use crate::models::{ScanChunk, ScanError};
use crate::platform::Scanner;

pub struct WindowsMftScanner;

impl WindowsMftScanner {
    pub fn new() -> Self {
        WindowsMftScanner
    }
}

impl Scanner for WindowsMftScanner {
    fn scan(
        &self,
        _path: &str,
        _tx: Sender<ScanChunk>,
        _cancel: Arc<AtomicBool>,
    ) -> Result<(), ScanError> {
        // Phase 8 will implement MFT parsing here.
        // For now, signal that MFT is unavailable so the caller can fall back.
        Err(ScanError::Permission(
            "MFT scanner not yet implemented (Phase 8)".to_string(),
        ))
    }
}

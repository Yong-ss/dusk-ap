pub mod universal;

#[cfg(windows)]
pub mod windows_mft;

use std::sync::{
    atomic::AtomicBool,
    mpsc::Sender,
    Arc,
};

use crate::models::{ScanChunk, ScanError, ScanOptions};

// ── Public Scanner trait ──────────────────────────────────────────────────────

pub trait Scanner: Send + Sync {
    /// Execute the scan synchronously (caller must run this on a blocking thread).
    ///
    /// * `path`   – Directory to scan.
    /// * `tx`     – Channel to stream `ScanChunk`s to the event emitter.
    /// * `cancel` – Set to `true` externally to abort early.
    fn scan(
        &self,
        path: &str,
        tx: Sender<ScanChunk>,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), ScanError>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/// Returns the best scanner available for the given path.
///
/// Strategy (Phase 2):
/// - Windows volume root + elevated →  WindowsMftScanner (stub — promotes to real in Phase 8)
/// - Everything else               →  UniversalScanner (walkdir)
pub fn create_scanner(path: &str, options: ScanOptions) -> Box<dyn Scanner> {
    #[cfg(windows)]
    {
        if is_volume_root(path) && is_elevated() {
            // Note: MFT stub doesn't use options yet
            return Box::new(windows_mft::WindowsMftScanner::new());
        }
    }

    Box::new(universal::UniversalScanner::new(options))
}

// ── Windows helpers (compile-time gated) ─────────────────────────────────────

#[cfg(windows)]
fn is_volume_root(path: &str) -> bool {
    // Matches "C:\", "D:\", "C:/", etc.
    let p = path.trim_end_matches(['/', '\\']);
    p.len() == 2 && p.as_bytes()[1] == b':'
}

#[cfg(windows)]
fn is_elevated() -> bool {
    // Quick heuristic: try to open \\.\PHYSICALDRIVE0 for read — needs admin.
    // For Phase 2 we keep it simple: always return false so MFT stub is never selected.
    // Phase 8 will replace this with a proper IsUserAnAdmin() call.
    false
}

#[cfg(windows)]
pub mod windows_mft;

use std::sync::{
    atomic::AtomicBool,
    mpsc::Sender,
    Arc,
};

use crate::models::{ScanChunk, ScanError, ScanOptions};

pub trait Scanner: Send + Sync {
    fn scan(
        &self,
        path: &str,
        scan_id: String,
        tx: Sender<ScanChunk>,
        cancel: Arc<AtomicBool>,
        cache: Arc<tokio::sync::RwLock<Option<crate::models::MftCache>>>,
    ) -> Result<(), ScanError>;
}

pub fn create_scanner(path: &str, _options: ScanOptions) -> (Box<dyn Scanner>, &'static str) {
    #[cfg(windows)]
    {
        if is_volume_root(path) && is_elevated() {
            return (Box::new(windows_mft::WindowsMftScanner::new()), "mft");
        }
    }

    // Default or Error for non-NTFS/non-Windows
    (Box::new(windows_mft::WindowsMftScanner::new()), "mft")
}

#[cfg(windows)]
fn is_volume_root(path: &str) -> bool {
    let p = path.trim_end_matches(['/', '\\']);
    p.len() == 2 && p.as_bytes()[1] == b':'
}

#[cfg(windows)]
fn is_elevated() -> bool {
    unsafe { windows::Win32::UI::Shell::IsUserAnAdmin().into() }
}

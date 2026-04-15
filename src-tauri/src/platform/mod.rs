#[cfg(windows)]
pub mod windows_mft;
pub mod walkdir_scanner;

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
        // MFT for volume roots OR subdirectories (if elevated)
        // This allows scanning the whole disk but focusing on a subfolder.
        if is_elevated() {
            let drive_path = path.trim_start_matches("\\\\?\\");
            if drive_path.len() >= 2 && drive_path.as_bytes()[1] == b':' {
                return (Box::new(windows_mft::WindowsMftScanner::new()), "mft");
            }
        }

        if is_volume_root(path) {
            return (Box::new(windows_mft::WindowsMftScanner::new()), "mft");
        }
        return (Box::new(walkdir_scanner::WalkdirScanner::new()), "walkdir");
    }

    #[cfg(not(windows))]
    {
        (Box::new(walkdir_scanner::WalkdirScanner::new()), "walkdir")
    }
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

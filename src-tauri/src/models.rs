use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    pub show_hidden_files: bool,
    pub include_system_files: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveInfo {
    pub name: String,
    pub mount_point: String,
    pub total_space: u64,
    pub available_space: u64,
}

// ── File system node ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    /// Unique ID — SipHash of the absolute path (hex string)
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Bytes. For directories this is the recursive total accumulated during scan.
    pub size: u64,
    pub kind: NodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
    /// Unix timestamp of last modification (seconds).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    File,
    Dir,
}

// ── Shared MFT Cache for On-Demand File Resolving ───────────────────────────

#[derive(Debug, Clone)]
pub struct MftEntry {
    pub name: String,
    pub parent_id: u64,
    pub size: u64,
    pub kind: NodeKind,
}

pub struct MftCache {
    pub raw_entries: Vec<Option<MftEntry>>,
    pub hierarchy: Vec<Vec<u64>>,
}

// ── Scan progress ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scanned: u64,
    pub total_size: u64,
    pub current_path: String,
    pub done: bool,
    /// Total MFT records or file count estimate if available
    pub total_records: Option<u64>,
    /// Percentage indicator for Phase 1 (indexing)
    pub processed_records: Option<u64>,
}

// ── Streaming chunk emitted as a Tauri event ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanChunk {
    pub scan_id: String,
    pub nodes: Vec<FileNode>,
    pub progress: ScanProgress,
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum ScanError {
    Io(std::io::Error),
    Permission(String),
    Cancelled,
}

impl std::fmt::Display for ScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScanError::Io(e) => write!(f, "I/O error: {e}"),
            ScanError::Permission(msg) => write!(f, "Permission denied: {msg}"),
            ScanError::Cancelled => write!(f, "Scan cancelled"),
        }
    }
}

impl From<std::io::Error> for ScanError {
    fn from(e: std::io::Error) -> Self {
        ScanError::Io(e)
    }
}

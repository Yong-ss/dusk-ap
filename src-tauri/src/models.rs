use serde::{Deserialize, Serialize};

// ── File system node ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    /// Unique ID — SipHash of the absolute path (hex string)
    pub id: String,
    pub name: String,
    pub path: String,
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

// ── Scan progress ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub scanned: u64,
    pub total_size: u64,
    pub current_path: String,
    pub done: bool,
}

// ── Streaming chunk emitted as a Tauri event ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanChunk {
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

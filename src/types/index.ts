// ── Drives ──────────────────────────────────────────────────────────────────

export interface DriveInfo {
  name: string;
  mount_point: string;
  total_space: number;
  available_space: number;
}

// ── File system node ─────────────────────────────────────────────────────────

export interface FileNode {
  /** SipHash of the absolute path, hex string. */
  id: string;
  name: string;
  path: string;
  /** Bytes. Directories hold the recursive total. */
  size: number;
  kind: "file" | "dir";
  extension?: string;
  children?: FileNode[];
  /** Unix timestamp (seconds) of last modification. */
  modified?: number;
}

// ── Scan progress ─────────────────────────────────────────────────────────────

export interface ScanProgress {
  scanned: number;
  totalSize: number;
  currentPath: string;
  done: boolean;
  totalRecords?: number;
  processedRecords?: number;
}

// ── Streaming chunk received from Tauri event ─────────────────────────────────

export interface ScanChunk {
  nodes: FileNode[];
  progress: ScanProgress;
}

// ── Treemap rendering ─────────────────────────────────────────────────────────

export interface TreemapRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0 = root, 1 = child, … */
  depth: number;
  /** PixiJS format 0xRRGGBB */
  color: number;
  label: string;
  size: number;
  kind: "file" | "dir";
  extension?: string;
  modified?: number;
  path: string;
}

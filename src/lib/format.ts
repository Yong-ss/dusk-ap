/**
 * Formatting utilities.
 */

/** Formats a file size in bytes to a human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  // Keep 2 decimal places for anything KB or larger.
  const val = bytes / Math.pow(k, i);
  return `${i >= 1 ? val.toFixed(2) : val} ${sizes[i]}`;
}

/** Formats an integer with thousands separators. */
export function formatCount(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}

/** Formats a Unix timestamp (seconds) into a local date string. */
export function formatDate(timestampSecs?: number): string {
  if (!timestampSecs) return "Unknown date";
  return new Date(timestampSecs * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Extracts the parent path from an absolute path string (cross-platform / or \). */
export function getParentPath(path: string): string {
  // Normalize visually by taking everything before the last slash.
  // Special case: Windows drives like "C:\" become "C:".
  const match = path.match(/^(.*)[/\\][^/\\]+$/);
  if (!match) return path; // Already at root or invalid.
  
  const parent = match[1];
  // If the slash we matched was the root slash (e.g., "C:\" -> "C:"), we keep the slash.
  if (parent.endsWith(":")) return parent + "\\";
  if (parent === "") return "/";
  return parent;
}

/** Truncates a long path with a middle ellipsis. */
export function truncatePath(path: string, maxLength: number): string {
  if (path.length <= maxLength) return path;
  
  const charsToShow = maxLength - 3;
  const frontChars = Math.ceil(charsToShow / 2);
  const backChars = Math.floor(charsToShow / 2);
  
  return path.substring(0, frontChars) + "..." + path.substring(path.length - backChars);
}

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { formatBytes, formatDate } from "../lib/format";
import type { TreemapRect } from "../types";

export interface ContextMenuState {
  x: number;
  y: number;
  rect: TreemapRect;
}

interface ContextMenuProps {
  state: ContextMenuState | null;
  onClose: () => void;
}

export default function ContextMenu({ state, onClose }: ContextMenuProps) {
  // Close on Escape or click outside
  useEffect(() => {
    if (!state) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#context-menu")) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    // Use mousedown instead of click to prevent conflict with right-click opening
    window.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [state, onClose]);

  if (!state) return null;

  const { x, y, rect } = state;
  const isDir = rect.kind === "dir";

  // Prevent menu from overflowing viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const safeX = x + 250 > vw ? vw - 250 : x;
  const safeY = y + 250 > vh ? vh - 250 : y;

  const handleOpenExplorer = async () => {
    try {
      await revealItemInDir(rect.path);
    } catch (e) {
      console.error("Failed to open path:", e);
    }
    onClose();
  };

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(rect.path);
    } catch (e) {
      console.error("Failed to copy path:", e);
    }
    onClose();
  };

  const handleDelete = async () => {
    const typeLabel = isDir ? "directory and all its contents" : "file";
    try {
      const yes = await ask(
        `Are you sure you want to permanently delete this ${typeLabel}?\n\n${rect.path}`,
        {
          title: "Confirm Deletion",
          kind: "warning",
        }
      );
      if (yes) {
        await invoke("delete_path", { path: rect.path });
        // Since we don't have a live watcher yet, we just delete it on the backend.
        // A full rescan or manual state prune would be needed to reflect this, 
        // but that's out of scope for Phase 5 drill-down interactions unless specified.
        alert("Deleted successfully. (Rescan to see changes)");
      }
    } catch (e) {
      console.error("Failed to delete path:", e);
      alert(`Deletion failed: ${e}`);
    }
    onClose();
  };

  return (
    <div
      id="context-menu"
      className="fixed z-[10000] flex w-60 flex-col overflow-hidden rounded-xl border border-border-soft bg-card/95 py-1.5 shadow-2xl backdrop-blur-xl"
      style={{ left: safeX, top: safeY }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 pb-2 pt-1.5">
        <p className="truncate text-sm font-medium text-primary">{rect.label || "Unnamed"}</p>
        <p className="truncate text-xs text-muted">{rect.path}</p>
      </div>

      <div className="h-px bg-border-soft" />

      <div className="p-1.5 flex flex-col gap-0.5">
        <button
          onClick={handleOpenExplorer}
          className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-primary transition-colors hover:bg-white/10"
        >
          Open in Explorer
        </button>
        <button
          onClick={handleCopyPath}
          className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-primary transition-colors hover:bg-white/10"
        >
          Copy Path
        </button>
      </div>

      <div className="h-px bg-border-soft" />

      <div className="flex flex-col gap-1 px-3 py-2 text-xs text-muted">
        <div className="flex justify-between">
          <span>Type</span>
          <span className="font-medium text-primary">{isDir ? "Folder" : "File"}</span>
        </div>
        <div className="flex justify-between">
          <span>Size</span>
          <span className="font-mono text-primary">{formatBytes(rect.size)}</span>
        </div>
        <div className="flex justify-between">
          <span>Modified</span>
          <span className="text-primary truncate ml-2">
            {rect.modified ? formatDate(rect.modified) : "Unknown"}
          </span>
        </div>
      </div>

      <div className="h-px bg-border-soft" />

      <div className="p-1.5">
        <button
          onClick={handleDelete}
          className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/20"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

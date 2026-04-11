import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileNode, ScanChunk, ScanProgress } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseScanReturn {
  startScan: (path: string) => Promise<void>;
  cancelScan: () => Promise<void>;
  tree: FileNode | null;
  progress: ScanProgress | null;
  isScanning: boolean;
  error: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Throttle interval for React state updates (ms). */
const THROTTLE_MS = 300;

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Manages a Tauri disk scan session.
 *
 * Design notes:
 * - The flat node list is accumulated in a `useRef` (no re-renders per chunk).
 * - `setState` is called at most every THROTTLE_MS to update the UI.
 * - The hook owns unlisten cleanup — safe to call startScan() repeatedly.
 */
export function useScan(): UseScanReturn {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flat accumulation buffer — never triggers renders.
  const nodeBuffer = useRef<Map<string, FileNode>>(new Map());

  // Throttle timer handle.
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup handles for Tauri event listeners.
  const unlistenChunk = useRef<UnlistenFn | null>(null);
  const unlistenError = useRef<UnlistenFn | null>(null);

  // ── Internal helpers ────────────────────────────────────────────────────────

  const cleanupListeners = useCallback(() => {
    unlistenChunk.current?.();
    unlistenError.current?.();
    unlistenChunk.current = null;
    unlistenError.current = null;
  }, []);

  const flushTree = useCallback((finalProgress: ScanProgress | null) => {
    // Build a synthetic root from the flat node map.
    // In Phase 5 this becomes the real tree assembly; for now it's a flat list.
    const nodes = Array.from(nodeBuffer.current.values());

    if (nodes.length === 0) {
      setTree(null);
    } else {
      // Create a virtual root node that holds all top-level entries.
      const root: FileNode = {
        id: "root",
        name: "Scan Root",
        path: finalProgress?.current_path ?? "",
        size: finalProgress?.total_size ?? 0,
        kind: "dir",
        children: nodes,
      };
      setTree(root);
    }
    if (finalProgress) setProgress(finalProgress);
  }, []);

  const scheduleFlush = useCallback(
    (latestProgress: ScanProgress) => {
      if (throttleTimer.current !== null) return; // already scheduled
      throttleTimer.current = setTimeout(() => {
        throttleTimer.current = null;
        flushTree(latestProgress);
      }, THROTTLE_MS);
    },
    [flushTree],
  );

  // ── Public API ──────────────────────────────────────────────────────────────

  const startScan = useCallback(
    async (path: string) => {
      // Clean up any previous session.
      cleanupListeners();
      if (throttleTimer.current) {
        clearTimeout(throttleTimer.current);
        throttleTimer.current = null;
      }
      nodeBuffer.current.clear();
      setTree(null);
      setProgress(null);
      setError(null);
      setIsScanning(true);

      // Subscribe before invoking to avoid missing early chunks.
      unlistenChunk.current = await listen<ScanChunk>("scan_chunk", (event) => {
        const { nodes, progress: prog } = event.payload;

        // Accumulate into the buffer (useRef → no re-render).
        for (const node of nodes) {
          nodeBuffer.current.set(node.id, node);
        }

        if (prog.done) {
          // Final chunk — flush immediately, tear down session.
          if (throttleTimer.current) {
            clearTimeout(throttleTimer.current);
            throttleTimer.current = null;
          }
          flushTree(prog);
          setIsScanning(false);
          cleanupListeners();
        } else {
          scheduleFlush(prog);
        }
      });

      unlistenError.current = await listen<string>("scan_error", (event) => {
        setError(event.payload);
        setIsScanning(false);
        cleanupListeners();
      });

      try {
        await invoke("scan_directory", { path });
      } catch (err) {
        setError(String(err));
        setIsScanning(false);
        cleanupListeners();
      }
    },
    [cleanupListeners, flushTree, scheduleFlush],
  );

  const cancelScan = useCallback(async () => {
    try {
      await invoke("cancel_scan");
    } catch {
      // Ignore — scan may have already finished.
    }
    setIsScanning(false);
    cleanupListeners();
  }, [cleanupListeners]);

  return { startScan, cancelScan, tree, progress, isScanning, error };
}

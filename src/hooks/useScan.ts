import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileNode, ScanChunk, ScanProgress } from "../types";
import type { Settings } from "./useSettings";

export interface UseScanReturn {
  startScan: (path: string, options: Settings) => Promise<void>;
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
    const nodes = Array.from(nodeBuffer.current.values());

    if (nodes.length === 0) {
      setTree(null);
    } else {
      // 1. Sort nodes by path length, shortest first. This ensures parents are created before children.
      nodes.sort((a, b) => a.path.length - b.path.length);

      // 2. Build map of path -> FileNode representing the tree properly.
      const treeMap = new Map<string, FileNode>();
      let rootPath = finalProgress?.current_path ?? "";
      
      // If the scan root hasn't been emitted as a separate node yet, make sure we have a root.
      // But usually walkdir gives the target folder path as the very first entry.
      if (nodes.length > 0 && !rootPath) {
         rootPath = nodes[0].path;
      }
      
      for (const node of nodes) {
        // Clone node because we will mutate children
        const clonedNode = { ...node, children: node.kind === "dir" ? [] : undefined };
        treeMap.set(node.path, clonedNode);
      }

      // 3. Re-parent the nodes.
      let rootNode: FileNode | null = null;

      for (const [path, node] of treeMap.entries()) {
        // Simple heuristic: if this is exactly the root path (ignoring trailing slashes), it's the root.
        if (rootPath && (path === rootPath || path + "\\" === rootPath || path + "/" === rootPath)) {
          rootNode = node;
          continue;
        }

        // Find parent path.
        // It's everything up to the last slash.
        let parentPath = path;
        const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        if (lastSlash >= 0) {
          parentPath = path.substring(0, lastSlash);
          
          // If Windows drive (C:\) was the parent, keep the slash.
          if (parentPath.endsWith(':')) {
            parentPath += path[lastSlash];
          } else if (parentPath === "") {
            // Root path /
            parentPath = "/";
          }
        } else {
          // No slash found = must be relative path or itself a root. Fallback.
          parentPath = "";
        }

        // If we can't find the exact parent, we fallback and attach it to the rootNode (or ignore).
        const parentNode = treeMap.get(parentPath);
        if (parentNode && parentNode.children) {
          parentNode.children.push(node);
        } else if (!rootNode && path === nodes[0].path) {
          // If we never hit the exact root path, the shortest path is our fallback root.
          rootNode = node;
        } else if (rootNode && rootNode.children) {
           rootNode.children.push(node); // Orphan fallback
        }
      }

      setTree(rootNode || treeMap.get(nodes[0].path) || null);
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
    async (path: string, options: Settings) => {
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
        await invoke("scan_directory", { 
          path, 
          options: {
            showCase: options.showHiddenFiles, // using camelCase for models.rs serde
            showHiddenFiles: options.showHiddenFiles,
            includeSystemFiles: options.includeSystemFiles,
          }
        });
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

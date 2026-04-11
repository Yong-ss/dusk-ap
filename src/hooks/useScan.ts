import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { FileNode, ScanProgress, ScanChunk, DriveInfo } from '../types';
import { getParentPath } from '../lib/format';

export function useScan() {
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [rootNode, setRootNode] = useState<FileNode | null>(null);
  
  // Timing & Estimations
  const [duration, setDuration] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [estimatedTotalSize, setEstimatedTotalSize] = useState<number | null>(null);

  const treeMapRef = useRef<Map<string, FileNode>>(new Map());
  const bufferRef = useRef<FileNode[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanPathRef = useRef<string | null>(null);

  const flushBuffer = useCallback(() => {
    if (bufferRef.current.length > 0) {
      const newNodes = [...bufferRef.current];
      bufferRef.current = [];

      const map = treeMapRef.current;
      newNodes.forEach((node) => {
        // ID-based lookup (O(1)) instead of heavy path string comparison
        const existing = map.get(node.id);
        
        const nodeInTree = existing || { ...node, children: node.kind === 'dir' ? [] : undefined };
        
        if (!existing) {
          map.set(node.id, nodeInTree);

          // Parent-ID based linking (O(1))
          if (node.parentId) {
            const parent = map.get(node.parentId);
            if (parent && parent.kind === 'dir') {
              if (!parent.children) parent.children = [];
              parent.children.push(nodeInTree);
              
              // Lazy Path Reconstruction (only if path is empty)
              if (!nodeInTree.path && parent.path) {
                nodeInTree.path = `${parent.path}\\${nodeInTree.name}`;
              }
            }
          }
        } else {
          // Rust now sends the pre-aggregated recursive size. Just update.
          nodeInTree.size = node.size;
          nodeInTree.modified = node.modified;
        }
      });

      // Performance Optimization: Set rootNode efficiently. 
      // Instead of sorting all 2M nodes, we just look for the node matching our scan path.
      if (!rootNode && scanPathRef.current) {
        // Special case: Find root node by matching path if it was the entry point
        // Or we can find by name if we know the root ID is "5"
        const root = Array.from(map.values()).find(n => n.path === scanPathRef.current);
        if (root) setRootNode(root);
      }
      
      // Force a slight re-render to update the UI with progress
      setProgress(p => p ? { ...p } : null);
    }
  }, [rootNode]);

  const startScan = useCallback(async (path: string) => {
    if (unlistenRef.current) unlistenRef.current();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (tickerRef.current) clearInterval(tickerRef.current);

    setProgress(null);
    setIsScanning(true);
    setRootNode(null);
    setDuration(null);
    setElapsedTime(0);
    setEstimatedTotalSize(null);
    
    const now = Date.now();
    startTimeRef.current = now;
    treeMapRef.current = new Map();
    bufferRef.current = [];
    scanPathRef.current = path;

    // Hybrid Progress: Heuristic for Volume Roots
    const isRoot = path === '/' || (path.length <= 3 && path.includes(':'));
    if (isRoot) {
      try {
        const drives = await invoke<DriveInfo[]>('get_drives');
        const drive = drives.find(d => path.startsWith(d.mount_point));
        if (drive) {
          setEstimatedTotalSize(drive.total_space - drive.available_space);
        }
      } catch (err) {
        console.error('[useScan] Drive info error:', err);
      }
    }

    tickerRef.current = setInterval(() => {
      setElapsedTime(Date.now() - (startTimeRef.current || Date.now()));
    }, 100);

    const unlisten = await listen<ScanChunk>('scan_chunk', (event) => {
      const { nodes: chunkNodes, progress: currentProgress } = event.payload;
      
      bufferRef.current.push(...chunkNodes);
      setProgress(currentProgress);

      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          flushBuffer();
          timerRef.current = null;
        }, 300);
      }

      if (currentProgress.done) {
        flushBuffer();
        setIsScanning(false);
        setDuration(Date.now() - (startTimeRef.current || Date.now()));
        if (tickerRef.current) clearInterval(tickerRef.current);
      }
    });

    unlistenRef.current = unlisten;

    try {
      await invoke('scan_directory', { 
        path, 
        options: { showHiddenFiles: false, includeSystemFiles: false } 
      });
    } catch (err) {
      console.error('[useScan] Scan error:', err);
      setIsScanning(false);
      if (tickerRef.current) clearInterval(tickerRef.current);
      unlisten();
    }
  }, [flushBuffer]);

  const cancelScan = useCallback(async () => {
    try {
      await invoke('cancel_scan');
      setIsScanning(false);
      if (tickerRef.current) clearInterval(tickerRef.current);
    } catch (err) {
      console.error('[useScan] Cancel error:', err);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (unlistenRef.current) unlistenRef.current();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  return { isScanning, progress, rootNode, treeMap: treeMapRef.current, startScan, cancelScan, elapsedTime, duration, estimatedTotalSize };
}

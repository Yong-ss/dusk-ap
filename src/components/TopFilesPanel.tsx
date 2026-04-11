import { useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { FileNode } from "../types";
import { getFlattenedFiles } from "../lib/filter";
import { formatBytes } from "../lib/format";

interface TopFilesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pass the FULL, unfiltered tree here as requested. */
  tree: FileNode | null;
  /** Callback fired when a file is clicked, allows App.tsx to drill down */
  onFileClick: (file: FileNode, parentPath: string) => void;
}

export default function TopFilesPanel({ isOpen, onClose, tree, onFileClick }: TopFilesPanelProps) {
  // Compute top 50 files only when tree changes
  const topFiles = useMemo(() => {
    if (!tree) return [];
    return getFlattenedFiles(tree).slice(0, 50);
  }, [tree]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Invisible backdrop to capture clicks outside */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[40]"
            onClick={onClose}
          />
          
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 z-[50] flex w-80 flex-col border-l border-border-soft bg-black/80 backdrop-blur-3xl shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border-soft px-5 py-4 shrink-0">
              <h2 className="text-sm font-semibold tracking-wide text-primary">Top 50 Largest Files</h2>
              <button
                aria-label="Close panel"
                className="rounded-full bg-white/10 p-1.5 text-muted hover:bg-white/20 hover:text-primary transition-colors"
                onClick={onClose}
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 scroll-smooth">
              {topFiles.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted">No files scanned.</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {topFiles.map((n, i) => {
                    const parentPath = n.path.substring(0, Math.max(n.path.lastIndexOf('/'), n.path.lastIndexOf('\\')));
                    return (
                      <button
                        key={n.id}
                        onClick={() => {
                           onFileClick(n, parentPath);
                        }}
                        className="flex w-full items-start gap-3 rounded-lg p-2 hover:bg-white/5 transition-colors text-left"
                      >
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/10 text-[10px] font-bold text-muted">
                          {i + 1}
                        </div>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p className="truncate text-sm font-medium text-primary">{n.name}</p>
                          <p className="truncate text-xs text-muted">{parentPath}</p>
                        </div>
                        <div className="shrink-0 text-xs font-mono text-indigo-300">
                          {formatBytes(n.size)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

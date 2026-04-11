import { motion, AnimatePresence } from "framer-motion";
import type { TreemapRect } from "../types";
import { formatBytes, formatDate } from "../lib/format";

interface TooltipProps {
  rect: TreemapRect | null;
  /** Mouse position relative to viewport */
  position: { x: number; y: number };
  /** Pre-calculated stats from App if needed, or total size for percentage calculation */
  totalSize: number;
}

export default function Tooltip({ rect, position, totalSize }: TooltipProps) {
  if (!rect) return null;

  // Simple collision prevention for viewport edges.
  // We assume max tooltip dimension: 280x160
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const xOffset = position.x + 20 + 280 > vw ? -280 - 10 : 20;
  const yOffset = position.y + 20 + 160 > vh ? -160 - 10 : 20;

  const pct = totalSize > 0 
    ? ((rect.size / totalSize) * 100).toFixed(2) 
    : "0.00";

  return (
    <AnimatePresence>
      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        initial={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="pointer-events-none fixed z-[9999] flex w-64 flex-col gap-2 rounded-xl border border-border-soft bg-black/80 p-4 shadow-2xl backdrop-blur-xl"
        style={{
          left: position.x + xOffset,
          top: position.y + yOffset,
        }}
      >
        <div className="flex items-start justify-between gap-2 overflow-hidden">
          <p className="truncate font-semibold text-primary">{rect.label || "Unnamed"}</p>
          <div className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
            {rect.kind === "dir" ? "DIR" : rect.extension || "FILE"}
          </div>
        </div>

        <div className="mt-1 flex flex-col gap-1 text-xs text-muted">
          <div className="flex justify-between">
            <span>Size</span>
            <span className="font-mono text-primary">{formatBytes(rect.size)}</span>
          </div>
          <div className="flex justify-between">
            <span>Share</span>
            <span className="font-mono text-primary">{pct}%</span>
          </div>
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/10">
            <span className="shrink-0">Modified</span>
             <span className="font-mono text-primary truncate">
                {rect.modified ? formatDate(rect.modified) : "Unknown"}
             </span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * TreemapCanvas — React wrapper around the tiered renderer system.
 *
 * Lifecycle:
 *  - Mount    → createRenderer() (async) → draws 500 demo rects
 *  - Resize   → ResizeObserver → renderer.resize()
 *  - Prop update (`rects`) → renderer.drawRects(rects)
 *  - Unmount  → renderer.destroy() — removes DOM element + cleans up listeners
 *
 * A renderer-tier badge is shown in the bottom-right corner once init completes.
 * An "Initializing renderer…" overlay is shown while the benchmark runs.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createRenderer } from "../renderer";
import type { Renderer, RendererTier } from "../renderer/interface";
import type { TreemapRect } from "../types";

// ── Demo data generator ───────────────────────────────────────────────────────

const PALETTE = [
  0x6366f1, // video — indigo
  0x10b981, // image — emerald
  0xf59e0b, // document — amber
  0xef4444, // archive — red
  0x06b6d4, // code — cyan
  0x6b7280, // system — slate
  0x8b5cf6, // other — purple
];

function makeRandomRects(count: number, w: number, h: number): TreemapRect[] {
  return Array.from({ length: count }, (_, i) => {
    const rw = 30 + Math.random() * 140;
    const rh = 22 + Math.random() * 90;
    return {
      id: `demo-${i}`,
      x: Math.random() * Math.max(0, w - rw),
      y: Math.random() * Math.max(0, h - rh),
      width: rw,
      height: rh,
      depth: Math.floor(Math.random() * 4),
      color: PALETTE[i % PALETTE.length],
      label: `block-${i}`,
      size: Math.floor(1e6 + Math.random() * 9e8),
      kind: Math.random() > 0.3 ? "file" : "dir",
      path: `dummy/path/block-${i}`,
    } satisfies TreemapRect;
  });
}

// ── Tier badge config ─────────────────────────────────────────────────────────

const TIER_LABEL: Record<RendererTier, string> = {
  webgl: "⚡ WebGL",
  canvas2d: "◼ Canvas 2D",
  svg: "◇ SVG",
};

const TIER_CSS: Record<RendererTier, string> = {
  webgl:
    "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
  canvas2d:
    "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  svg:
    "border-amber-500/40 bg-amber-500/15 text-amber-300",
};

// ── Component ─────────────────────────────────────────────────────────────────

interface TreemapCanvasProps {
  /** When provided, the renderer draws these instead of the 500 demo rects. */
  rects?: TreemapRect[];
  onHover?: (rect: TreemapRect | null) => void;
  onClick?: (rect: TreemapRect) => void;
}

export default function TreemapCanvas({ rects, onHover, onClick }: TreemapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<Renderer | null>(null);

  const [tier, setTier] = useState<RendererTier | null>(null);
  const [ready, setReady] = useState(false);

  // ── Mount ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let alive = true;

    console.log("[dusk/ui] TreemapCanvas: Initializing renderer...");
    createRenderer(container).then(({ renderer, tier: t }) => {
      console.log(`[dusk/ui] TreemapCanvas: Renderer ready (tier: ${t})`);
      if (!alive) {
        renderer.destroy();
        return;
      }

      rendererRef.current = renderer;

      // Wire callbacks.
      if (onHover) renderer.onHover(onHover);
      if (onClick) renderer.onClick(onClick);

      setTier(t);
      setReady(true);

      // Draw 500 demo rects (or provided rects if any).
      const { width, height } = container.getBoundingClientRect();
      const initial = rects ?? makeRandomRects(500, width, height);
      renderer.drawRects(initial);
    }).catch(err => {
      console.error("[dusk/ui] TreemapCanvas: Failed to initialize renderer", err);
      setReady(true); // Force ready so overlay disappears even on error
    });

    // ── ResizeObserver ────────────────────────────────────────────────────────
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? {};
      if (width && height) rendererRef.current?.resize(width, height);
    });
    ro.observe(container);

    return () => {
      alive = false;
      ro.disconnect();
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
    // Note: intentionally only runs on mount/unmount (no dep on rects/callbacks
    // — those are handled in the effects below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-draw when rects prop changes ───────────────────────────────────────
  useEffect(() => {
    if (ready && rects && rendererRef.current) {
      rendererRef.current.drawRects(rects);
    }
  }, [ready, rects]);

  // ── Update callbacks when props change ────────────────────────────────────
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.onHover(onHover ?? (() => undefined));
    r.onClick(onClick ?? (() => undefined));
  }, [onHover, onClick]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative h-full w-full overflow-hidden" id="treemap-canvas-root">
      {/* The renderer mounts its canvas/SVG directly inside this div. */}
      <div className="absolute inset-0" ref={containerRef} />

      {/* Initializing overlay */}
      <AnimatePresence>
        {!ready && (
          <motion.div
            key="init-overlay"
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/30 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 1 }}
          >
            {/* Spinner */}
            <motion.div
              animate={{ rotate: 360 }}
              className="h-8 w-8 rounded-full border-2 border-white/20 border-t-indigo-400"
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            />
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Benchmarking renderer…
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Renderer tier badge */}
      <AnimatePresence>
        {tier && (
          <motion.div
            key="tier-badge"
            animate={{ opacity: 1, y: 0 }}
            className={`absolute bottom-3 right-3 z-20 rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide ${TIER_CSS[tier]}`}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0, y: 6 }}
            transition={{ delay: 0.1 }}
          >
            {TIER_LABEL[tier]}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

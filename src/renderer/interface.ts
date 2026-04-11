import type { TreemapRect } from "../types";

// ── Renderer tiers ────────────────────────────────────────────────────────────

export type RendererTier = "webgl" | "canvas2d" | "svg";

// ── Common interface every renderer must implement ───────────────────────────

export interface Renderer {
  /** Replace all currently drawn rects with a new set. */
  drawRects(rects: TreemapRect[]): void;

  /** Erase everything from the drawing surface. */
  clear(): void;

  /** Called when the container element resizes. */
  resize(w: number, h: number): void;

  /**
   * Register a hover callback.
   * Receives the hovered rect, or `null` when the cursor leaves.
   */
  onHover(callback: (rect: TreemapRect | null) => void): void;

  /** Register a click callback. */
  onClick(callback: (rect: TreemapRect) => void): void;

  /** Tear down the renderer and remove its DOM element from the container. */
  destroy(): void;

  /** The tier this renderer represents. */
  readonly tier: RendererTier;
}

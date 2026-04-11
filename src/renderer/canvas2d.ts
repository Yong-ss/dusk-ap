/**
 * Tier 2 — HTML5 Canvas 2D renderer.
 *
 * Dirty-rect optimization:
 *   - drawRects() triggers a full redraw (data changed, must re-layout).
 *   - Hover changes are micro-optimized: only the previously hovered rect and
 *     the newly hovered rect are repainted, keeping the rest untouched.
 *
 * This keeps 60fps on hover interactions even with thousands of blocks,
 * while still being correct when data changes.
 */

import type { Renderer, RendererTier } from "./interface";
import type { TreemapRect } from "../types";

export class Canvas2DRenderer implements Renderer {
  readonly tier: RendererTier = "canvas2d";

  private readonly _canvas: HTMLCanvasElement;
  private readonly _ctx: CanvasRenderingContext2D;
  private _rects: TreemapRect[] = [];
  private _hoveredIndex = -1;

  private _hoverCb: ((r: TreemapRect | null) => void) | null = null;
  private _clickCb: ((r: TreemapRect) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    this._ctx = canvas.getContext("2d")!;

    canvas.addEventListener("pointermove", this._onPointerMove);
    canvas.addEventListener("click", this._onClick);
    canvas.addEventListener("mouseleave", this._onMouseLeave);
  }

  // ── Renderer interface ──────────────────────────────────────────────────────

  drawRects(rects: TreemapRect[]): void {
    this._rects = rects;
    this._hoveredIndex = -1;
    this._fullRedraw();
  }

  clear(): void {
    this._rects = [];
    this._hoveredIndex = -1;
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
  }

  resize(w: number, h: number): void {
    this._canvas.width = w;
    this._canvas.height = h;
    if (this._rects.length > 0) this._fullRedraw();
  }

  onHover(cb: (r: TreemapRect | null) => void): void {
    this._hoverCb = cb;
  }

  onClick(cb: (r: TreemapRect) => void): void {
    this._clickCb = cb;
  }

  destroy(): void {
    this._canvas.removeEventListener("pointermove", this._onPointerMove);
    this._canvas.removeEventListener("click", this._onClick);
    this._canvas.removeEventListener("mouseleave", this._onMouseLeave);
    this._canvas.remove();
  }

  // ── Drawing helpers ─────────────────────────────────────────────────────────

  private _fullRedraw(): void {
    const { _ctx: ctx, _canvas: cv, _rects: rects } = this;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < rects.length; i++) {
      this._paintRect(i, i === this._hoveredIndex);
    }
  }

  /**
   * Paint a single rect at index `i`.
   * Dirty-rect variant: clears only that rect's bounding box before painting.
   */
  private _paintRect(i: number, hovered: boolean): void {
    const ctx = this._ctx;
    const r = this._rects[i];

    const css = `#${r.color.toString(16).padStart(6, "0")}`;
    ctx.fillStyle = hovered ? this._brighten(css) : css;
    ctx.fillRect(r.x, r.y, r.width, r.height);

    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1);

    if (r.label && r.width > 60 && r.height > 20) {
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(r.label, r.x + 4, r.y + 14, r.width - 8);
    }
  }

  /**
   * Dirty-rect repaint for a single rect.
   * Clears only the affected pixel area then repaints it.
   */
  private _repaintOne(i: number, hovered: boolean): void {
    const r = this._rects[i];
    if (!r) return;
    // +1px bleed to erase anti-aliased border edge cleanly.
    this._ctx.clearRect(r.x - 1, r.y - 1, r.width + 2, r.height + 2);
    this._paintRect(i, hovered);
  }

  private _brighten(hex: string): string {
    const shift = 45;
    const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + shift);
    const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + shift);
    const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + shift);
    return `rgb(${r},${g},${b})`;
  }

  // ── Hit-testing ─────────────────────────────────────────────────────────────

  private _hitTest(x: number, y: number): number {
    for (let i = this._rects.length - 1; i >= 0; i--) {
      const r = this._rects[i];
      if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) {
        return i;
      }
    }
    return -1;
  }

  private _relativeCoords(e: MouseEvent): { x: number; y: number } {
    const b = this._canvas.getBoundingClientRect();
    const scaleX = this._canvas.width / b.width;
    const scaleY = this._canvas.height / b.height;
    return {
      x: (e.clientX - b.left) * scaleX,
      y: (e.clientY - b.top) * scaleY,
    };
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  private readonly _onPointerMove = (e: PointerEvent): void => {
    const { x, y } = this._relativeCoords(e);
    const hit = this._hitTest(x, y);

    if (hit === this._hoveredIndex) return; // no change

    // ── Dirty-rect: repaint only old and new hover regions ──────────────────
    const prev = this._hoveredIndex;
    this._hoveredIndex = hit;

    if (prev >= 0) this._repaintOne(prev, false);
    if (hit >= 0) this._repaintOne(hit, true);

    this._hoverCb?.(hit >= 0 ? this._rects[hit] : null);
  };

  private readonly _onClick = (e: MouseEvent): void => {
    const { x, y } = this._relativeCoords(e);
    const hit = this._hitTest(x, y);
    if (hit >= 0) this._clickCb?.(this._rects[hit]);
  };

  private readonly _onMouseLeave = (): void => {
    if (this._hoveredIndex < 0) return;
    const prev = this._hoveredIndex;
    this._hoveredIndex = -1;
    this._repaintOne(prev, false);
    this._hoverCb?.(null);
  };
}

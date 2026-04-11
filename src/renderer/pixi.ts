/**
 * Tier 1 — PixiJS WebGL renderer.
 *
 * Object-pooling design:
 *   _pool  — idle Graphics instances ready to be reused
 *   _active — Graphics instances currently displayed on stage
 *
 * On each drawRects() call:
 *   1. Return all _active to _pool (calls g.clear(), removes from stage)
 *   2. For each new rect, pop from _pool (or create new) → draw → push to _active
 *
 * Hover / click detection uses point-in-rect lookup against the stored rects
 * array rather than PixiJS hit-testing — this avoids switching eventMode on
 * every pooled Graphics object and is O(n) with no GC pressure.
 */

import { Application, Graphics } from "pixi.js";
import type { Renderer, RendererTier } from "./interface";
import type { TreemapRect } from "../types";

export class PixiJSRenderer implements Renderer {
  readonly tier: RendererTier = "webgl";

  private readonly _app: Application;
  private readonly _pool: Graphics[] = [];
  private _active: Graphics[] = [];
  private _rects: TreemapRect[] = [];

  private _hoverCb: ((r: TreemapRect | null) => void) | null = null;
  private _clickCb: ((r: TreemapRect) => void) | null = null;

  constructor(app: Application) {
    this._app = app;

    const cv = app.canvas as HTMLCanvasElement;
    cv.addEventListener("pointermove", this._onPointerMove);
    cv.addEventListener("click", this._onClick);
    cv.addEventListener("mouseleave", this._onMouseLeave);
  }

  // ── Pool helpers ────────────────────────────────────────────────────────────

  private _acquire(): Graphics {
    return this._pool.pop() ?? new Graphics();
  }

  private _release(g: Graphics): void {
    g.clear();
    this._app.stage.removeChild(g);
    this._pool.push(g);
  }

  // ── Renderer interface ──────────────────────────────────────────────────────

  drawRects(rects: TreemapRect[]): void {
    this._rects = rects;

    // Return all active objects to pool.
    for (const g of this._active) this._release(g);
    this._active = [];

    // Draw new set.
    for (const r of rects) {
      const g = this._acquire();
      g.rect(r.x, r.y, r.width, r.height).fill({ color: r.color, alpha: 1 });
      this._app.stage.addChild(g);
      this._active.push(g);
    }
  }

  clear(): void {
    for (const g of this._active) this._release(g);
    this._active = [];
    this._rects = [];
  }

  resize(w: number, h: number): void {
    this._app.renderer.resize(w, h);
  }

  onHover(cb: (r: TreemapRect | null) => void): void {
    this._hoverCb = cb;
  }

  onClick(cb: (r: TreemapRect) => void): void {
    this._clickCb = cb;
  }

  destroy(): void {
    const cv = this._app.canvas as HTMLCanvasElement;
    cv.removeEventListener("pointermove", this._onPointerMove);
    cv.removeEventListener("click", this._onClick);
    cv.removeEventListener("mouseleave", this._onMouseLeave);
    // true = also remove canvas from DOM
    this._app.destroy(true);
  }

  // ── Hit-testing ─────────────────────────────────────────────────────────────

  private _hitTest(x: number, y: number): TreemapRect | null {
    // Iterate in reverse so top-most (last drawn) rects win.
    for (let i = this._rects.length - 1; i >= 0; i--) {
      const r = this._rects[i];
      if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) {
        return r;
      }
    }
    return null;
  }

  private _clientToCanvas(e: MouseEvent): { x: number; y: number } {
    const bounds = (this._app.canvas as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
  }

  // ── Event handlers (arrow fns to preserve `this`) ───────────────────────────

  private readonly _onPointerMove = (e: PointerEvent): void => {
    if (!this._hoverCb) return;
    const { x, y } = this._clientToCanvas(e);
    this._hoverCb(this._hitTest(x, y));
  };

  private readonly _onClick = (e: MouseEvent): void => {
    if (!this._clickCb) return;
    const { x, y } = this._clientToCanvas(e);
    const hit = this._hitTest(x, y);
    if (hit) this._clickCb(hit);
  };

  private readonly _onMouseLeave = (): void => {
    this._hoverCb?.(null);
  };
}

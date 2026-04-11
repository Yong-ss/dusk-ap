/**
 * Tier 3 — SVG renderer (fallback for environments where WebGL and Canvas 2D
 * are unavailable or too slow).
 *
 * Capped at MAX_ELEMENTS to prevent DOM explosion.
 * Hover effects are CSS-driven (transition + brightness filter) so they
 * cost nothing extra on the JS side.
 */

import type { Renderer, RendererTier } from "./interface";
import type { TreemapRect } from "../types";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_ELEMENTS = 2000;

// Injected once into every SVG we create.
const HOVER_STYLE = `
  .dusk-r { cursor: pointer; transition: opacity 0.14s, filter 0.14s; }
  .dusk-r:hover { opacity: 0.75; filter: brightness(1.35); }
  .dusk-l { pointer-events: none; font: 11px ui-monospace, monospace; fill: rgba(255,255,255,0.82); }
`;

export class SVGRenderer implements Renderer {
  readonly tier: RendererTier = "svg";

  private readonly _container: HTMLElement;
  private _svg: SVGSVGElement;
  private _rects: TreemapRect[] = [];

  private _hoverCb: ((r: TreemapRect | null) => void) | null = null;
  private _clickCb: ((r: TreemapRect) => void) | null = null;

  constructor(container: HTMLElement) {
    this._container = container;
    this._svg = this._createSvg();
    container.appendChild(this._svg);
  }

  // ── Renderer interface ──────────────────────────────────────────────────────

  drawRects(rects: TreemapRect[]): void {
    const limited = rects.length > MAX_ELEMENTS ? rects.slice(0, MAX_ELEMENTS) : rects;
    this._rects = limited;

    // Full DOM replacement — SVG has no incremental update worth optimising at
    // this tier (it's the fallback; correctness over cleverness).
    this._svg.remove();
    this._svg = this._createSvg();
    this._container.appendChild(this._svg);

    for (let i = 0; i < limited.length; i++) {
      const r = limited[i];
      const fill = `#${r.color.toString(16).padStart(6, "0")}`;

      const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
      rect.setAttribute("x", String(r.x));
      rect.setAttribute("y", String(r.y));
      rect.setAttribute("width", String(r.width));
      rect.setAttribute("height", String(r.height));
      rect.setAttribute("fill", fill);
      rect.setAttribute("stroke", "rgba(0,0,0,0.22)");
      rect.setAttribute("stroke-width", "0.5");
      rect.classList.add("dusk-r");

      // Capture index so the closure is correct.
      const idx = i;
      rect.addEventListener("pointerover", () => this._hoverCb?.(this._rects[idx]));
      rect.addEventListener("pointerout", () => this._hoverCb?.(null));
      rect.addEventListener("click", () => this._clickCb?.(this._rects[idx]));

      this._svg.appendChild(rect);

      // Label — only when the block is large enough to be readable.
      if (r.label && r.width > 60 && r.height > 20) {
        const text = document.createElementNS(SVG_NS, "text") as SVGTextElement;
        text.setAttribute("x", String(r.x + 4));
        text.setAttribute("y", String(r.y + 14));
        text.setAttribute("clip-path", `inset(0 0 0 0)`);
        text.classList.add("dusk-l");
        text.textContent = r.label.length > 20 ? r.label.slice(0, 18) + "…" : r.label;
        this._svg.appendChild(text);
      }
    }
  }

  clear(): void {
    this._rects = [];
    this._svg.remove();
    this._svg = this._createSvg();
    this._container.appendChild(this._svg);
  }

  resize(w: number, h: number): void {
    this._svg.setAttribute("width", String(w));
    this._svg.setAttribute("height", String(h));
  }

  onHover(cb: (r: TreemapRect | null) => void): void {
    this._hoverCb = cb;
  }

  onClick(cb: (r: TreemapRect) => void): void {
    this._clickCb = cb;
  }

  destroy(): void {
    this._svg.remove();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _createSvg(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.display = "block";

    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = HOVER_STYLE;
    svg.appendChild(style);

    return svg;
  }
}

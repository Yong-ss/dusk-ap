/**
 * Renderer factory — auto-selects the best rendering tier available.
 *
 * Selection order:
 *   1. PixiJS WebGL  (Tier 1) — benchmarked; downgrades if fps < FPS_THRESHOLD
 *   2. Canvas 2D     (Tier 2) — benchmarked; downgrades if fps < FPS_THRESHOLD
 *   3. SVG           (Tier 3) — always available, capped at 2 000 elements
 *
 * The benchmark draws BENCH_RECTS random rectangles for BENCH_DURATION_MS and
 * computes the achieved frame rate.  Any tier scoring below FPS_THRESHOLD is
 * discarded before falling through to the next tier.
 */

import { Application } from "pixi.js";
import { PixiJSRenderer } from "./pixi";
import { Canvas2DRenderer } from "./canvas2d";
import { SVGRenderer } from "./svg";
import type { Renderer, RendererTier } from "./interface";
import type { TreemapRect } from "../types";

// ── Benchmark constants ───────────────────────────────────────────────────────

const BENCH_RECTS = 1_000;
const BENCH_DURATION_MS = 600;
const FPS_THRESHOLD = 30;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBenchRects(w: number, h: number): TreemapRect[] {
  return Array.from({ length: BENCH_RECTS }, (_, i) => ({
    id: `bench-${i}`,
    x: Math.random() * (w - 80),
    y: Math.random() * (h - 50),
    width: 20 + Math.random() * 60,
    height: 15 + Math.random() * 35,
    depth: 0,
    color: (0x334155 + i * 0x1f7b) & 0xffffff,
    label: "",
    size: 1,
    kind: "file" as const,
    path: "",
  }));
}

function measureFps(renderer: Renderer, rects: TreemapRect[]): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();

    const tick = (): void => {
      renderer.drawRects(rects);
      frames++;
      if (performance.now() - start < BENCH_DURATION_MS) {
        requestAnimationFrame(tick);
      } else {
        renderer.clear();
        resolve((frames / (performance.now() - start)) * 1_000);
      }
    };

    requestAnimationFrame(tick);
  });
}

// ── Public factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns the best available renderer for `container`.
 * Mounts the renderer's drawing surface (canvas or SVG) inside `container`.
 */
export async function createRenderer(
  container: HTMLElement,
): Promise<{ renderer: Renderer; tier: RendererTier }> {
  const w = container.clientWidth || 800;
  const h = container.clientHeight || 600;
  const benchRects = makeBenchRects(w, h);

  // ── Tier 1: PixiJS WebGL ──────────────────────────────────────────────────
  try {
    const app = new Application();
    await app.init({
      width: w,
      height: h,
      antialias: false,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio ?? 1,
      autoDensity: true,
    });

    // Style + mount the PixiJS canvas.
    const cv = app.canvas as HTMLCanvasElement;
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    container.appendChild(cv);

    const pixi = new PixiJSRenderer(app);
    const fps = await measureFps(pixi, benchRects);
    console.info(`[dusk/renderer] WebGL: ${fps.toFixed(1)} fps`);

    if (fps >= FPS_THRESHOLD) {
      return { renderer: pixi, tier: "webgl" };
    }

    console.warn(`[dusk/renderer] WebGL ${fps.toFixed(1)} fps < ${FPS_THRESHOLD} — downgrading`);
    pixi.destroy(); // removes canvas from DOM via app.destroy(true)
  } catch (err) {
    console.warn("[dusk/renderer] WebGL unavailable:", err);
  }

  // ── Tier 2: Canvas 2D ─────────────────────────────────────────────────────
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    container.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");

    const c2d = new Canvas2DRenderer(canvas);
    const fps = await measureFps(c2d, benchRects);
    console.info(`[dusk/renderer] Canvas2D: ${fps.toFixed(1)} fps`);

    if (fps >= FPS_THRESHOLD) {
      return { renderer: c2d, tier: "canvas2d" };
    }

    console.warn(`[dusk/renderer] Canvas2D ${fps.toFixed(1)} fps < ${FPS_THRESHOLD} — downgrading`);
    c2d.destroy(); // removes canvas from DOM
  } catch (err) {
    console.warn("[dusk/renderer] Canvas2D unavailable:", err);
  }

  // ── Tier 3: SVG (always succeeds) ────────────────────────────────────────
  console.info("[dusk/renderer] Using SVG fallback");
  return { renderer: new SVGRenderer(container), tier: "svg" };
}

// Re-export interface types so consumers only need to import from this module.
export type { Renderer, RendererTier } from "./interface";

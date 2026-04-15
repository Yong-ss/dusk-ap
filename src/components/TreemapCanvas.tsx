import React, { useRef, useEffect, useState, useCallback } from 'react';
import { FileNode } from '../types';
import { formatBytes } from '../lib/format';
import ContextMenu, { ContextMenuState } from './ContextMenu';

// ── Types ────────────────────────────────────────────────────────────────────

interface TreemapCanvasProps {
  viewRoot: FileNode | null;
  onNodeClick: (node: FileNode) => void;
  viewFiles?: FileNode[];
}

interface RectInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  node: FileNode;
  depth: number;
  hue: number;
  container: boolean; // true = directory with children drawn inside it
}

// ── Color System ─────────────────────────────────────────────────────────────

const PALETTE_HUES = [210, 150, 30, 340, 180, 60, 270, 120, 0, 240, 90, 310];

function hslToRgb(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `rgb(${Math.round(f(0) * 255)},${Math.round(f(8) * 255)},${Math.round(f(4) * 255)})`;
}

function headerColor(hue: number, depth: number): string {
  const sat = Math.max(20, 45 - depth * 10);
  const light = Math.max(12, 22 - depth * 4);
  return hslToRgb(hue, sat, light);
}

function borderColor(hue: number, depth: number): string {
  const sat = Math.max(15, 35 - depth * 8);
  const light = Math.max(18, 30 - depth * 5);
  return hslToRgb(hue, sat, light);
}

function leafColor(hue: number, depth: number, isFiles: boolean): string {
  const sat = Math.max(28, 50 - depth * 5);
  const light = isFiles ? 40 : 32;
  return hslToRgb(hue, sat, Math.max(14, light - depth * 3));
}

const HEADER_H = [0, 24, 20];
const BORDER = 3;
const RADIUS = 6;

// Helper for high-tech corner brackets on hover
function drawCornerBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  const size = Math.min(w, h, 12);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  
  // Top Left
  ctx.beginPath();
  ctx.moveTo(x, y + size); ctx.lineTo(x, y); ctx.lineTo(x + size, y);
  ctx.stroke();
  
  // Top Right
  ctx.beginPath();
  ctx.moveTo(x + w - size, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + size);
  ctx.stroke();
  
  // Bottom Left
  ctx.beginPath();
  ctx.moveTo(x, y + h - size); ctx.lineTo(x, y + h); ctx.lineTo(x + size, y + h);
  ctx.stroke();
  
  // Bottom Right
  ctx.beginPath();
  ctx.moveTo(x + w - size, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - size);
  ctx.stroke();
}

// Helper for relative size bar
function drawPercentageBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, percent: number, color: string) {
  if (w < 20 || h < 40) return;
  const barH = 2;
  const barY = y + h - barH - 4;
  const barX = x + 6;
  const barW = w - 12;
  
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(barX, barY, barW, barH);
  
  ctx.fillStyle = color;
  ctx.fillRect(barX, barY, barW * percent, barH);
}

// Helper for glass rim light
function drawGlassRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, isHovered: boolean) {
  ctx.save();
  
  // Outer Glow if hovered
  if (isHovered) {
    ctx.shadowBlur = 15;
    ctx.shadowColor = color.replace('rgb', 'rgba').replace(')', ', 0.4)');
  }

  ctx.beginPath();
  // @ts-ignore
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, RADIUS);
  else ctx.rect(x, y, w, h);
  
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  // Glass Rim / Specular highlight (Inner border)
  ctx.lineWidth = 1;
  ctx.strokeStyle = isHovered ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)';
  ctx.stroke();

  // Subtle gloss gradient
  if (w > 10 && h > 10) {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, 'rgba(255,255,255,0.08)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = grad;
    ctx.fill();
  }
}

// ── Squarified Layout ────────────────────────────────────────────────────────

function worstAspect(row: number[], side: number, area: number): number {
  if (row.length === 0) return Infinity;
  const s2 = side * side;
  let mn = row[0], mx = row[0];
  for (let i = 1; i < row.length; i++) {
    if (row[i] < mn) mn = row[i];
    if (row[i] > mx) mx = row[i];
  }
  const a2 = area * area;
  return Math.max((s2 * mx) / a2, a2 / (s2 * mn));
}

interface LayoutItem { node: FileNode; area: number; hue: number }

function squarify(
  items: LayoutItem[],
  x: number, y: number, w: number, h: number,
  depth: number, maxDepth: number,
  rects: RectInfo[]
) {
  if (items.length === 0) return;
  if (items.length === 1) {
    layoutNode(items[0].node, x, y, w, h, depth, maxDepth, rects, items[0].hue);
    return;
  }

  const total = items.reduce((s, it) => s + it.area, 0);
  if (total <= 0) return;

  const shorter = Math.min(w, h);
  const row: number[] = [];
  let rowArea = 0;
  let i = 0;

  row.push(items[0].area);
  rowArea = items[0].area;
  i = 1;
  while (i < items.length) {
    const prev = worstAspect(row, shorter, rowArea);
    row.push(items[i].area);
    rowArea += items[i].area;
    if (worstAspect(row, shorter, rowArea) > prev) {
      row.pop();
      rowArea -= items[i].area;
      break;
    }
    i++;
  }

  const frac = rowArea / total;
  let rw: number, rh: number;
  if (w >= h) { rw = w * frac; rh = h; }
  else { rw = w; rh = h * frac; }

  let px = x, py = y;
  for (let j = 0; j < row.length; j++) {
    const f = row[j] / rowArea;
    const it = items[j];
    if (w >= h) {
      const ch = rh * f;
      layoutNode(it.node, px, py, rw, ch, depth, maxDepth, rects, it.hue);
      py += ch;
    } else {
      const cw = rw * f;
      layoutNode(it.node, px, py, cw, rh, depth, maxDepth, rects, it.hue);
      px += cw;
    }
  }

  const rest = items.slice(row.length);
  if (rest.length > 0) {
    if (w >= h) squarify(rest, x + rw, y, w - rw, h, depth, maxDepth, rects);
    else squarify(rest, x, y + rh, w, h - rh, depth, maxDepth, rects);
  }
}

function layoutNode(
  node: FileNode,
  x: number, y: number, w: number, h: number,
  depth: number, maxDepth: number,
  rects: RectInfo[],
  hue: number = 0
) {
  const hasChildren = node.children && node.children.length > 0;

  // Leaf: no children OR at max depth
  if (!hasChildren || depth >= maxDepth) {
    if (w >= 0.5 && h >= 0.5) {
      rects.push({ x, y, w, h, node, depth, hue, container: false });
    }
    return;
  }

  // Container: directory with children to show inside
  // Reserve: border on all sides + header bar at top
  const hdr = HEADER_H[Math.min(depth, HEADER_H.length - 1)] || 18;
  const innerX = x + BORDER;
  const innerY = y + hdr;
  const innerW = w - BORDER * 2;
  const innerH = h - hdr - BORDER;

  // Too small to show children — render as leaf instead
  if (innerW < 8 || innerH < 8) {
    if (w >= 0.5 && h >= 0.5) {
      rects.push({ x, y, w, h, node, depth, hue: 0, container: false });
    }
    return;
  }

  // Push container rect (drawn first as background/border/header)
  rects.push({ x, y, w, h, node, depth, hue, container: true });

  // Prepare children
  const sorted = [...(node.children || [])].sort((a, b) => (b.size || 0) - (a.size || 0));
  const totalSize = node.size || 1;
  const childrenSize = sorted.reduce((s, c) => s + (c.size || 0), 0);
  const remaining = totalSize - childrenSize;
  if (remaining > totalSize * 0.0001) {
    sorted.push({
      id: node.id + '_files', name: '<Files>', size: remaining,
      kind: 'file' as const, path: node.path + '\\<Files>',
    });
    sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
  }

  const totalChild = sorted.reduce((s, c) => s + (c.size || 0), 0) || 1;
  const area = innerW * innerH;
  const items: LayoutItem[] = sorted
    .filter(c => (c.size || 0) / totalChild > 0.0001)
    .map((c, idx) => {
      let childHue: number;
      if (depth === 0) {
        childHue = PALETTE_HUES[idx % PALETTE_HUES.length];
      } else {
        const jitter = (idx % 5 - 2) * 6;
        childHue = (hue + jitter + 360) % 360;
      }
      return { node: c, area: ((c.size || 0) / totalChild) * area, hue: childHue };
    });

  squarify(items, innerX, innerY, innerW, innerH, depth + 1, maxDepth, rects);
}

// ── Canvas Drawing ───────────────────────────────────────────────────────────

function drawAll(
  ctx: CanvasRenderingContext2D,
  rects: RectInfo[],
  hovId: string | null,
  canvasW: number, canvasH: number,
  rootSize: number
) {
  // Deep Background
  ctx.fillStyle = '#020617'; // Slate 950
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Schematic Grid Pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < canvasW; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasH); ctx.stroke();
  }
  for (let y = 0; y < canvasH; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasW, y); ctx.stroke();
  }

  for (const r of rects) {
    const x = Math.floor(r.x);
    const y = Math.floor(r.y);
    const w = Math.max(1, Math.floor(r.w));
    const h = Math.max(1, Math.floor(r.h));
    if (w < 1 || h < 1) continue;

    const isHov = r.node.id === hovId;
    const percent = (r.node.size || 0) / rootSize;

    if (r.container) {
      const hdr = HEADER_H[Math.min(r.depth, HEADER_H.length - 1)] || 18;
      
      // Draw Container with Rounded Corners & HSL Style
      drawGlassRect(ctx, x, y, w, h, borderColor(r.hue, r.depth), isHov);

      // Header highlight (opaque enough for text)
      ctx.fillStyle = headerColor(r.hue, r.depth);
      if (ctx.roundRect) {
        ctx.beginPath();
        // @ts-ignore
        ctx.roundRect(x, y, w, hdr, [RADIUS, RADIUS, 0, 0]);
        ctx.fill();
      }

      // Header text
      if (w > 40) {
        const fontSize = hdr >= 22 ? 11 : 9;
        ctx.font = `700 ${fontSize}px "JetBrains Mono", "Consolas", monospace`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        const maxTW = w - 12;
        let label = '📁 ' + r.node.name;
        if (ctx.measureText(label).width > maxTW) {
          while (label.length > 1 && ctx.measureText(label + '\u2026').width > maxTW) {
            label = label.slice(0, -1);
          }
          label += '\u2026';
        }

        const tx = x + 8;
        const ty = y + hdr / 2;

        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(label, tx, ty, maxTW);
      }

    } else {
      // ── Leaf block: Rounded Glass Fill (Restored HSL) ──
      const isFiles = r.node.name === '<Files>';
      const color = leafColor(r.hue, r.depth, isFiles);
      drawGlassRect(ctx, x, y, w, h, color, isHov);

      if (isFiles) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
        ctx.setLineDash([]);
      }

      // Leaf label (name + size)
      if (w > 50 && h > 20) {
        const fontSize = (w > 120 && h > 32) ? 11 : 9;
        ctx.font = `700 ${fontSize}px "Inter", "Segoe UI", sans-serif`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        const maxTW = w - 12;

        const icon = r.node.kind === 'dir' ? '📁 ' : '📄 ';
        let label = icon + r.node.name;
        if (ctx.measureText(label).width > maxTW) {
          while (label.length > 1 && ctx.measureText(label + '\u2026').width > maxTW) {
            label = label.slice(0, -1);
          }
          label += '\u2026';
        }

        const tx = x + 8;
        const ty = y + 8;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillText(label, tx + 0.5, ty + 0.5, maxTW);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText(label, tx, ty, maxTW);

        // Size on second line
        if (h > 30 && r.node.size) {
          ctx.font = `500 ${Math.max(8, fontSize - 1)}px "JetBrains Mono", monospace`;
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.fillText(formatBytes(r.node.size), tx, ty + fontSize + 4, maxTW);
        }
      }

      // Percentage Bar
      drawPercentageBar(ctx, x, y, w, h, percent, hslToRgb(r.hue, 60, 50));
    }

    // Corner Brackets on Hover
    if (isHov) {
      drawCornerBrackets(ctx, x, y, w, h, 'rgba(255,255,255,0.8)');
    }
  }
}

function drawEmptyState(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const s = 54, ix = cx - s / 2, iy = cy - 60;
  
  // Custom Folder Icon
  ctx.fillStyle = 'rgba(107,114,128,0.15)';
  ctx.beginPath();
  if (ctx.roundRect) {
    // @ts-ignore
    ctx.roundRect(ix, iy + 14, s, s - 14, 6);
    ctx.fill();
    ctx.beginPath();
    // @ts-ignore
    ctx.roundRect(ix, iy + 4, s * 0.45, 12, [6, 6, 0, 0]);
    ctx.fill();
  } else {
    ctx.fillRect(ix, iy + 14, s, s - 14);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 15px Inter, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(148,163,184,0.6)';
  ctx.fillText('Select a folder to begin', cx, cy + 35);
  ctx.font = '500 12px Inter, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(148,163,184,0.35)';
  ctx.fillText('Click "Scan Folder" in the sidebar', cx, cy + 58);
}

// ── Component ────────────────────────────────────────────────────────────────

const MAX_DEPTH = 2; // viewRoot / children / grandchildren — no deeper

export default function TreemapCanvas({ viewRoot, onNodeClick, viewFiles }: TreemapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<RectInfo[]>([]);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const hoveredRef = useRef<RectInfo | null>(null);
  const [hoveredTooltip, setHoveredTooltip] = useState<RectInfo | null>(null);
  const rafRef = useRef<number>(0);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const rectsRef = useRef<RectInfo[]>([]);
  rectsRef.current = rects;

  // ── Resize Observer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setDimensions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Layout ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!viewRoot || dimensions.width === 0 || dimensions.height === 0) {
      setRects([]);
      return;
    }

    // Inject real files into viewRoot so treemap shows individual files instead of <Files>
    let root = viewRoot;
    if (viewFiles && viewFiles.length > 0) {
      const dirs = (viewRoot.children || []).filter(c => c.kind === 'dir');
      root = { ...viewRoot, children: [...dirs, ...viewFiles] };
    }

    const r: RectInfo[] = [];
    layoutNode(root, 0, 0, dimensions.width, dimensions.height, 0, MAX_DEPTH, r);
    setRects(r);
  }, [viewRoot, viewFiles, dimensions]);

  // ── Draw ─────────────────────────────────────────────────────────────────
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
    ctx.scale(dpr, dpr);

    const cur = rectsRef.current;
    if (cur.length === 0) {
      drawEmptyState(ctx, dimensions.width, dimensions.height);
      return;
    }

    const hovId = hoveredRef.current?.node.id ?? null;
    drawAll(ctx, cur, hovId, dimensions.width, dimensions.height, viewRoot?.size || 1);
  }, [dimensions, viewRoot]);

  useEffect(() => { redrawCanvas(); }, [rects, redrawCanvas]);

  // ── Mouse ────────────────────────────────────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!canvasRef.current || rectsRef.current.length === 0) return;
    const br = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - br.left;
    const my = e.clientY - br.top;

    // Find the deepest (last) rect that contains the point
    let found: RectInfo | null = null;
    const r = rectsRef.current;
    for (let i = r.length - 1; i >= 0; i--) {
      const ri = r[i];
      if (mx >= ri.x && mx <= ri.x + ri.w && my >= ri.y && my <= ri.y + ri.h) {
        found = ri;
        break;
      }
    }

    if (found?.node.id !== hoveredRef.current?.node.id) {
      hoveredRef.current = found;
      setHoveredTooltip(found);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(redrawCanvas);
    }
  };

  const handleMouseLeave = () => {
    hoveredRef.current = null;
    setHoveredTooltip(null);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(redrawCanvas);
  };

  const handleClick = () => {
    if (hoveredRef.current && hoveredRef.current.node.kind === 'dir') {
      onNodeClick(hoveredRef.current.node);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const node = hoveredRef.current?.node;
    if (!node || !node.path) return;
    const isVirtual = node.name === '<Files>';
    const path = isVirtual ? node.path.replace(/\\<Files>$/, '') : node.path;
    const name = isVirtual ? path.split('\\').pop() || path : node.name;
    setCtxMenu({ x: e.clientX, y: e.clientY, path, name, size: node.size, isVirtual });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full" ref={containerRef}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className="absolute inset-0 cursor-pointer"
      />

      {ctxMenu && (
        <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}

      {hoveredTooltip && !ctxMenu && (
        <div
          className="pointer-events-none absolute z-50 bg-[#0f172a]/85 backdrop-blur-[24px] border border-white/20 px-4 py-3 rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.5)] min-w-[200px] max-w-[280px]"
          style={{
            left: Math.min(hoveredTooltip.x + 14, (containerRef.current?.clientWidth || 9999) - 290),
            top: Math.min(hoveredTooltip.y + 14, (containerRef.current?.clientHeight || 9999) - 100),
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div 
              className="w-2.5 h-2.5 rounded-full shrink-0" 
              style={{ backgroundColor: leafColor(hoveredTooltip.hue, hoveredTooltip.depth, hoveredTooltip.node.name === '<Files>') }}
            />
            <span className="text-[9px] uppercase tracking-[0.12em] text-gray-500 font-bold">
              {hoveredTooltip.node.kind === 'dir' ? 'Folder' : 'File'}
            </span>
          </div>
          <div className="text-sm font-bold text-white truncate mb-1.5 leading-tight">
            {hoveredTooltip.node.name}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
            <span className="text-sm font-bold text-emerald-400 font-mono">
              {formatBytes(hoveredTooltip.node.size || 0)}
            </span>
            {viewRoot && viewRoot.size > 0 && (
              <span className="text-[11px] font-mono text-gray-500 font-medium">
                {(((hoveredTooltip.node.size || 0) / viewRoot.size) * 100).toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

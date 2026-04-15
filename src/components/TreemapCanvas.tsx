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

const HEADER_H = [0, 22, 18]; // header height per depth (0=root, 1=child, 2=grandchild)
const BORDER = 2;

function hslToRgb(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `rgb(${Math.round(f(0) * 255)},${Math.round(f(8) * 255)},${Math.round(f(4) * 255)})`;
}

// Container header bar color
function headerColor(hue: number, depth: number): string {
  const sat = Math.max(20, 45 - depth * 10);
  const light = Math.max(12, 22 - depth * 4);
  return hslToRgb(hue, sat, light);
}

// Container border color
function borderColor(hue: number, depth: number): string {
  const sat = Math.max(15, 35 - depth * 8);
  const light = Math.max(18, 30 - depth * 5);
  return hslToRgb(hue, sat, light);
}

// Leaf fill color
function leafColor(hue: number, depth: number, isFiles: boolean): string {
  const sat = Math.max(28, 50 - depth * 5);
  const light = isFiles ? 40 : 32;
  return hslToRgb(hue, sat, Math.max(14, light - depth * 3));
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

  // Leaf: no children OR at max depth — solid block
  if (!hasChildren || depth >= maxDepth) {
    if (w >= 1 && h >= 1) {
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
  if (innerW < 10 || innerH < 10) {
    if (w >= 1 && h >= 1) {
      rects.push({ x, y, w, h, node, depth, hue, container: false });
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
  canvasW: number, canvasH: number
) {
  // Background
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, canvasW, canvasH);

  for (const r of rects) {
    const x = Math.floor(r.x);
    const y = Math.floor(r.y);
    const w = Math.max(1, Math.floor(r.w));
    const h = Math.max(1, Math.floor(r.h));
    if (w < 1 || h < 1) continue;

    const isHov = r.node.id === hovId;

    if (r.container) {
      // ── Container: border + header bar + background ──
      const hdr = HEADER_H[Math.min(r.depth, HEADER_H.length - 1)] || 18;

      // Border/background
      ctx.fillStyle = borderColor(r.hue, r.depth);
      ctx.fillRect(x, y, w, h);

      // Header bar
      ctx.fillStyle = headerColor(r.hue, r.depth);
      ctx.fillRect(x, y, w, hdr);

      // Hover: lighten header
      if (isHov) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x, y, w, hdr);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      }

      // Header text
      if (w > 40) {
        const fontSize = hdr >= 20 ? 12 : 10;
        ctx.font = `bold ${fontSize}px "Trebuchet MS","Segoe UI",sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        const maxTW = w - 8;
        let label = r.node.name;
        if (ctx.measureText(label).width > maxTW) {
          while (label.length > 1 && ctx.measureText(label + '\u2026').width > maxTW) {
            label = label.slice(0, -1);
          }
          label += '\u2026';
        }

        // Size suffix for large enough headers
        let sizeStr = '';
        if (w > 120 && r.node.size) {
          sizeStr = '  ' + formatBytes(r.node.size);
        }

        const tx = x + 5;
        const ty = y + hdr / 2;

        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(label, tx, ty, maxTW);

        if (sizeStr && ctx.measureText(label).width + ctx.measureText(sizeStr).width < maxTW) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillText(sizeStr, tx + ctx.measureText(label).width, ty);
        }
      }

    } else {
      // ── Leaf block: solid color fill ──
      const isFiles = r.node.name === '<Files>';
      ctx.fillStyle = leafColor(r.hue, r.depth, isFiles);
      ctx.fillRect(x, y, w, h);

      // Subtle gradient
      if (w > 8 && h > 8) {
        const grad = ctx.createLinearGradient(x, y, x + w, y + h);
        grad.addColorStop(0, 'rgba(255,255,255,0.05)');
        grad.addColorStop(1, 'rgba(0,0,0,0.08)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, w, h);
      }

      // 1px gap between siblings
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x + w - 1, y, 1, h);
      ctx.fillRect(x, y + h - 1, w, 1);

      // Hover
      if (isHov) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      }

      // Leaf label (name + size) for large enough blocks
      if (w > 60 && h > 20) {
        const fontSize = (w > 140 && h > 30) ? 11 : 9;
        ctx.font = `bold ${fontSize}px "Trebuchet MS","Segoe UI",sans-serif`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        const maxTW = w - 6;

        let label = r.node.name;
        if (ctx.measureText(label).width > maxTW) {
          while (label.length > 1 && ctx.measureText(label + '\u2026').width > maxTW) {
            label = label.slice(0, -1);
          }
          label += '\u2026';
        }

        const tx = x + 3;
        const ty = y + 3;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(label, tx + 1, ty + 1, maxTW);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(label, tx, ty, maxTW);

        // Size on second line if tall enough
        if (h > 34 && r.node.size) {
          ctx.font = `${Math.max(8, fontSize - 1)}px "Trebuchet MS","Segoe UI",sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.fillText(formatBytes(r.node.size), tx, ty + fontSize + 2, maxTW);
        }
      }
    }
  }
}

function drawEmptyState(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const s = 48, ix = cx - s / 2, iy = cy - 50;
  ctx.fillStyle = 'rgba(107,114,128,0.25)';
  ctx.beginPath();
  ctx.roundRect(ix, iy + 12, s, s - 12, 4);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(ix, iy + 2, s * 0.4, 14, [4, 4, 0, 0]);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = 'rgba(148,163,184,0.55)';
  ctx.fillText('Select a folder to begin', cx, cy + 30);
  ctx.font = '11px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = 'rgba(148,163,184,0.3)';
  ctx.fillText('Click "Scan Folder" in the sidebar', cx, cy + 52);
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
    drawAll(ctx, cur, hovId, dimensions.width, dimensions.height);
  }, [dimensions]);

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
          className="pointer-events-none absolute z-50 bg-gray-900/90 backdrop-blur-xl border border-gray-700/50 px-4 py-3 rounded-xl shadow-2xl text-xs min-w-[180px] max-w-[280px]"
          style={{
            left: Math.min(hoveredTooltip.x + 14, (containerRef.current?.clientWidth || 9999) - 290),
            top: Math.min(hoveredTooltip.y + 14, (containerRef.current?.clientHeight || 9999) - 100),
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: hslToRgb(hoveredTooltip.hue, 55, 50) }}
            />
            <span className="text-gray-400 font-semibold uppercase tracking-wider text-[10px]">
              {hoveredTooltip.node.kind === 'dir' ? 'Folder' : 'Files'}
            </span>
          </div>
          <div className="font-bold text-white truncate leading-snug">
            {hoveredTooltip.node.name}
          </div>
          <div className="flex items-center justify-between mt-1.5 text-gray-400">
            <span className="font-mono font-semibold text-emerald-400">
              {formatBytes(hoveredTooltip.node.size || 0)}
            </span>
            {viewRoot && viewRoot.size > 0 && (
              <span className="text-gray-500">
                {(((hoveredTooltip.node.size || 0) / viewRoot.size) * 100).toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

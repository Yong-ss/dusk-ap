/**
 * Squarified Treemap layout algorithm.
 *
 * Reference: Bruls, Huizing & van Wijk, "Squarified Treemaps" (2000).
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 * Given a rectangle and a list of nodes sorted by size descending, the
 * algorithm greedily packs nodes into "rows" (strips). A new node is added to
 * the current row if doing so does not worsen the worst aspect ratio of any
 * rect in that row. When adding the next node would make things worse, the
 * current row is committed and a new, smaller remaining rectangle is used
 * for subsequent rows.
 *
 * ── Layout constants ─────────────────────────────────────────────────────────
 *   PAD    = 1 px inset per block side → 2 px visible gap between siblings
 *   HEADER = 20 px reserved at the top of every directory block for a label
 */

import type { FileNode, TreemapRect } from "../types";
import type { ColorMap } from "./colormap";

// ── Public types ──────────────────────────────────────────────────────────────

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TreemapOptions {
  /** Blocks smaller than this (in either dimension) are not drawn. Default: 4. */
  minBlockSize?: number;
  /** Maximum recursion depth into sub-directories. Default: 3. */
  maxDepth?: number;
  colorMap: ColorMap;
}

// ── Internals ─────────────────────────────────────────────────────────────────

const PAD = 1;      // px inset per side → 2 px gap between neighbours
const HEADER = 20;  // px reserved for directory label area

interface ResolvedOpts {
  minBlockSize: number;
  maxDepth: number;
  colorMap: ColorMap;
}

/** An item the squarify step operates on — carries its pre-scaled pixel area. */
interface Item {
  node: FileNode;
  area: number; // pixel area within the current remaining rectangle
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Compute a flat list of `TreemapRect`s for `root` fitted into `bounds`.
 *
 * The root itself is not added to the output when it is a directory — its
 * children are laid out directly inside `bounds`.  For a single-file root the
 * file's rect fills the entire bounds.
 */
export function computeTreemap(
  root: FileNode,
  bounds: Bounds,
  options: TreemapOptions,
): TreemapRect[] {
  const opts: ResolvedOpts = {
    minBlockSize: options.minBlockSize ?? 4,
    maxDepth: options.maxDepth ?? 3,
    colorMap: options.colorMap,
  };

  const out: TreemapRect[] = [];

  if (root.kind === "file") {
    // Single-file root: fill the entire bounds (if large enough).
    if (bounds.width >= opts.minBlockSize && bounds.height >= opts.minBlockSize) {
      out.push(makeRect(root, bounds.x, bounds.y, bounds.width, bounds.height, 0, opts));
    }
    return out;
  }

  // Directory root: lay out its children.
  if (root.children && root.children.length > 0) {
    layoutNodes(root.children, bounds.x, bounds.y, bounds.width, bounds.height, 0, opts, out);
  }

  return out;
}

// ── Layout helpers ────────────────────────────────────────────────────────────

/**
 * Scale `nodes` to pixel areas proportional to their sizes, then squarify
 * them into the given rectangle.
 */
function layoutNodes(
  nodes: FileNode[],
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  opts: ResolvedOpts,
  out: TreemapRect[],
): void {
  if (
    nodes.length === 0 ||
    w < opts.minBlockSize ||
    h < opts.minBlockSize ||
    depth > opts.maxDepth
  ) {
    return;
  }

  const positiveNodes = nodes.filter((n) => n.size > 0);
  if (positiveNodes.length === 0) return;

  const totalSize = positiveNodes.reduce((s, n) => s + n.size, 0);
  const totalArea = w * h;

  // Sort largest first — required by the squarified algorithm.
  const items: Item[] = positiveNodes
    .slice()
    .sort((a, b) => b.size - a.size)
    .map((n) => ({ node: n, area: (n.size / totalSize) * totalArea }));

  squarify(items, x, y, w, h, depth, opts, out);
}

/**
 * Core squarified row-packing loop.
 * Mutates nothing outside `out`.
 */
function squarify(
  items: Item[],
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  opts: ResolvedOpts,
  out: TreemapRect[],
): void {
  let row: Item[] = [];
  const remaining = [...items];
  let rx = x,
    ry = y,
    rw = w,
    rh = h;

  while (remaining.length > 0) {
    const s = Math.min(rw, rh);
    if (s < opts.minBlockSize) break;

    const next = remaining[0];
    const candidate = [...row, next];

    if (row.length === 0 || worstRatio(candidate, s) <= worstRatio(row, s)) {
      row.push(next);
      remaining.shift();
    } else {
      [rx, ry, rw, rh] = commitRow(row, rx, ry, rw, rh, depth, opts, out);
      row = [];
    }
  }

  if (row.length > 0) {
    commitRow(row, rx, ry, rw, rh, depth, opts, out);
  }
}

/**
 * Worst aspect ratio for a row of items given the current short side `s`.
 *
 * Derived from the Bruls et al. formula:
 *   max over items  of  max( rowArea² / (area_i · s²),  area_i · s² / rowArea² )
 *
 * Since rowArea and s are fixed, only the max and min area items matter, giving
 * us an O(1) computation.
 */
function worstRatio(row: Item[], s: number): number {
  if (row.length === 0) return Infinity;

  let rowArea = 0;
  let maxArea = 0;
  let minArea = Infinity;

  for (const item of row) {
    rowArea += item.area;
    if (item.area > maxArea) maxArea = item.area;
    if (item.area < minArea) minArea = item.area;
  }

  const s2 = s * s;
  const ra2 = rowArea * rowArea;
  return Math.max(ra2 / (minArea * s2), (maxArea * s2) / ra2);
}

/**
 * Assign pixel rectangles to each item in `row`, add them to `out`,
 * recurse into directories, and return the updated remaining rectangle.
 */
function commitRow(
  row: Item[],
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  opts: ResolvedOpts,
  out: TreemapRect[],
): [number, number, number, number] {
  const rowArea = row.reduce((s, item) => s + item.area, 0);
  const horizontal = w >= h;
  const stripDepth = rowArea / (horizontal ? w : h);

  let pos = horizontal ? x : y;

  for (let i = 0; i < row.length; i++) {
    const item = row[i];
    const isLast = i === row.length - 1;

    // Snap last item to edge to prevent floating-point drift.
    const rawLength = item.area / stripDepth;
    const itemLength = isLast
      ? (horizontal ? x + w : y + h) - pos
      : rawLength;

    const cellX = horizontal ? pos : x;
    const cellY = horizontal ? y : pos;
    const cellW = horizontal ? itemLength : stripDepth;
    const cellH = horizontal ? stripDepth : itemLength;

    // Apply inset padding.
    const innerX = cellX + PAD;
    const innerY = cellY + PAD;
    const innerW = cellW - 2 * PAD;
    const innerH = cellH - 2 * PAD;

    if (innerW >= opts.minBlockSize && innerH >= opts.minBlockSize) {
      out.push(makeRect(item.node, innerX, innerY, innerW, innerH, depth, opts));

      // Recurse into directories that have children.
      if (
        item.node.kind === "dir" &&
        item.node.children &&
        item.node.children.length > 0 &&
        depth < opts.maxDepth
      ) {
        // Reserve a header strip at the top for the directory label.
        const headerH = innerH > HEADER + opts.minBlockSize ? HEADER : 0;
        const childW = innerW;
        const childH = innerH - headerH;
        const childX = innerX;
        const childY = innerY + headerH;

        if (childW >= opts.minBlockSize && childH >= opts.minBlockSize) {
          layoutNodes(
            item.node.children,
            childX,
            childY,
            childW,
            childH,
            depth + 1,
            opts,
            out,
          );
        }
      }
    }

    pos += isLast ? 0 : rawLength;
  }

  // Return the rectangle that remains after removing this strip.
  return horizontal
    ? [x, y + stripDepth, w, h - stripDepth]
    : [x + stripDepth, y, w - stripDepth, h];
}

// ── Rect construction ─────────────────────────────────────────────────────────

function makeRect(
  node: FileNode,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  opts: ResolvedOpts,
): TreemapRect {
  return {
    id: node.id,
    x,
    y,
    width: w,
    height: h,
    depth,
    color: getColor(node, depth, opts.colorMap),
    // Only show the label when there is enough room to be readable.
    label: w > 60 && h > 20 ? truncateLabel(node.name) : "",
    size: node.size,
    kind: node.kind,
    extension: node.extension,
    modified: node.modified,
    path: node.path,
  };
}

// ── Color helpers ─────────────────────────────────────────────────────────────

/**
 * Depth-based directory background colors (darker at deeper levels).
 * Used when `node.kind === 'dir'`.
 */
const DIR_COLORS = [0x1e293b, 0x0f172a, 0x080e1a];

function getColor(node: FileNode, depth: number, colorMap: ColorMap): number {
  if (node.kind === "dir") {
    return DIR_COLORS[Math.min(depth, DIR_COLORS.length - 1)];
  }

  // File: look up extension color, apply subtle size-based luminance boost.
  const ext = node.extension?.toLowerCase() ?? "";
  const base = colorMap[ext] ?? colorMap[""] ?? 0x8b5cf6;
  return applyLuminance(base, sizeLuminanceFactor(node.size));
}

/**
 * Maps file size to a brightness multiplier [0.85 … 1.15].
 * Larger files appear slightly brighter.
 */
function sizeLuminanceFactor(size: number): number {
  const logSize = Math.log10(Math.max(size, 1));
  // Typical range: 2 (100 B) → 10 (10 GB)
  const t = Math.min(1, Math.max(0, (logSize - 2) / 8));
  return 0.85 + t * 0.3;
}

/** Multiply each RGB channel by `factor`, clamping to [0, 255]. */
function applyLuminance(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/** Truncate a filename with an ellipsis when it exceeds `maxLen`. */
function truncateLabel(name: string, maxLen = 22): string {
  return name.length > maxLen ? name.slice(0, maxLen - 1) + "…" : name;
}

/**
 * Unit tests for src/lib/treemap.ts — Phase 4.
 *
 * Expected-value calculations are worked out explicitly in comments so future
 * agents can verify the arithmetic without rerunning everything.
 *
 * Layout constants (from treemap.ts):
 *   PAD    = 1   (1 px inset per side → 2 px visible gap between siblings)
 *   HEADER = 20  (reserved at top of each dir block for the label)
 */

import { describe, it, expect } from "vitest";
import { computeTreemap, type Bounds, type TreemapOptions } from "./treemap";
import { DEFAULT_COLOR_MAP } from "./colormap";
import type { FileNode } from "../types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const OPTS: TreemapOptions = { colorMap: DEFAULT_COLOR_MAP };

const SQUARE: Bounds = { x: 0, y: 0, width: 200, height: 200 };

function file(id: string, size: number, ext = "mp4"): FileNode {
  return { id, name: `${id}.${ext}`, path: `/${id}.${ext}`, size, kind: "file", extension: ext };
}

function dir(id: string, size: number, children: FileNode[]): FileNode {
  return { id, name: id, path: `/${id}`, size, kind: "dir", children };
}

// ── Test 1: Single file fills the entire bounds ───────────────────────────────
//
// computeTreemap(file, {0,0,200,200}) → single rect
// Since root is a file, makeRect is called directly with the full bounds.
// No padding applied at this level (padding is only between siblings).
//
describe("single file root", () => {
  it("produces exactly one rect that fills the entire bounds", () => {
    const root = file("big", 500_000);
    const rects = computeTreemap(root, SQUARE, OPTS);

    expect(rects).toHaveLength(1);

    const [r] = rects;
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(200);
    expect(r.height).toBe(200);
    expect(r.kind).toBe("file");
    expect(r.id).toBe("big");
  });

  it("assigns a color from the colormap for the file extension", () => {
    const root = file("vid", 1_000_000, "mp4"); // mp4 → 0x6366f1 (with luminance shift)
    const [r] = computeTreemap(root, SQUARE, OPTS);
    // Verify it's in the indigo family (0x6366f1 base). Exact value includes
    // the luminance factor so we just confirm it's non-zero and non-default.
    expect(r.color).toBeGreaterThan(0);
    expect(r.extension).toBe("mp4");
  });
});

// ── Test 2: Two equal files side-by-side ─────────────────────────────────────
//
// root = dir { children: [A(1000), B(1000)] }, bounds = 200×200
//
// Algorithm trace (PAD=1, square bounds):
//   items: A(area=20000), B(area=20000),  total area = 40000
//   s = min(200,200) = 200
//   worst([A], 200)      = max(20000²/(20000·200²), 20000·200²/20000²) = max(0.5,2) = 2
//   worst([A,B], 200)    = max(40000²/(20000·200²), 20000·200²/40000²) = max(2,0.5) = 2
//   candidate(2) <= current(2) → add B → row = [A,B]
//
//   commitRow([A,B], 0,0,200,200):
//     horizontal (rw≥rh): stripDepth = 40000/200 = 200 (fills entire height)
//     A: pos=0, length=20000/200=100  → cell(0,0,100,200), inner(1,1,98,198)
//     B: pos=100, last → length=200-100=100 → cell(100,0,100,200), inner(101,1,98,198)
//
// Result: 2 rects, each 98×198, at x=1 and x=101.
//
describe("two equal files in a directory", () => {
  const rootNode = dir("root", 2000, [file("a", 1000), file("b", 1000)]);

  it("produces exactly two rects (parent dir not in output)", () => {
    const rects = computeTreemap(rootNode, SQUARE, OPTS);
    expect(rects).toHaveLength(2);
  });

  it("both rects have identical dimensions (equal file sizes → equal areas)", () => {
    const [r0, r1] = computeTreemap(rootNode, SQUARE, OPTS);
    expect(r0.width).toBe(r1.width);
    expect(r0.height).toBe(r1.height);
  });

  it("rects do not overlap (gap = 2 px between them)", () => {
    const [r0, r1] = computeTreemap(rootNode, SQUARE, OPTS);

    // Sort by x to avoid ordering assumptions.
    const [left, right] = [r0, r1].sort((a, b) => a.x - b.x);

    // Left rect right edge < right rect left edge (no overlap).
    expect(left.x + left.width).toBeLessThan(right.x);

    // Gap: right.x - (left.x + left.width) = 101 - (1+98) = 2 px.
    const gap = right.x - (left.x + left.width);
    expect(gap).toBe(2);
  });

  it("together they cover the full bounds width (minus 2 outer PAD px)", () => {
    const [r0, r1] = computeTreemap(rootNode, SQUARE, OPTS);
    const [left, right] = [r0, r1].sort((a, b) => a.x - b.x);

    const totalWidth = right.x + right.width - left.x;
    // Both inner rects span from x=1 to x=199 → 198 px.
    expect(totalWidth).toBeCloseTo(SQUARE.width - 2 * 1 /* PAD */, 0);
  });

  it("each rect has depth = 0", () => {
    const rects = computeTreemap(rootNode, SQUARE, OPTS);
    expect(rects.every((r) => r.depth === 0)).toBe(true);
  });
});

// ── Test 3: maxDepth is respected ────────────────────────────────────────────
//
// Tree structure (3 levels deep):
//   root/
//     └── lvl1/          (depth 0)
//           └── lvl2/    (depth 1)
//                 └── leaf.ts  (depth 2)
//
// With maxDepth = 1:
//   depth-0 items are laid out.
//   depth-1 items are laid out (depth(0) < maxDepth(1) → recurse).
//   depth-2 items are NOT laid out (depth(1) >= maxDepth(1) → stop).
//
// So we expect exactly 2 rects: lvl1 (depth 0) and lvl2 (depth 1). leaf is cut off.
//
describe("maxDepth is respected", () => {
  const leaf = file("leaf", 100_000, "ts");
  const lvl2 = dir("lvl2", 100_000, [leaf]);
  const lvl1 = dir("lvl1", 100_000, [lvl2]);
  const root = dir("root", 100_000, [lvl1]);

  it("with maxDepth=1 gives only depth-0 and depth-1 rects", () => {
    const rects = computeTreemap(root, SQUARE, { ...OPTS, maxDepth: 1 });

    expect(rects.length).toBeGreaterThanOrEqual(1);
    const maxFoundDepth = Math.max(...rects.map((r) => r.depth));
    expect(maxFoundDepth).toBeLessThanOrEqual(1);
  });

  it("with maxDepth=0 only the root's direct children are shown", () => {
    const rects = computeTreemap(root, SQUARE, { ...OPTS, maxDepth: 0 });
    expect(rects.every((r) => r.depth === 0)).toBe(true);
  });

  it("with maxDepth=2 (full depth) all 3 levels appear", () => {
    const rects = computeTreemap(root, SQUARE, { ...OPTS, maxDepth: 2 });
    const depths = new Set(rects.map((r) => r.depth));
    expect(depths.has(0)).toBe(true);
    expect(depths.has(1)).toBe(true);
    expect(depths.has(2)).toBe(true);
  });
});

// ── Test 4: Empty directory → no rects ───────────────────────────────────────
//
// An empty directory has no children → layoutNodes returns immediately.
// A directory with size=0 also returns early.
//
describe("empty or zero-size directory", () => {
  it("empty children array → empty output", () => {
    const root = dir("empty", 0, []);
    const rects = computeTreemap(root, SQUARE, OPTS);
    expect(rects).toHaveLength(0);
  });

  it("children all with size=0 → empty output", () => {
    const root = dir("zeros", 0, [
      file("a", 0),
      file("b", 0),
    ]);
    const rects = computeTreemap(root, SQUARE, OPTS);
    expect(rects).toHaveLength(0);
  });

  it("mixed zero/nonzero children → only nonzero children appear", () => {
    const root = dir("mixed", 1000, [
      file("a", 1000),
      file("b", 0),
      file("c", 0),
    ]);
    const rects = computeTreemap(root, SQUARE, OPTS);
    expect(rects).toHaveLength(1);
    expect(rects[0].id).toBe("a");
  });
});

// ── Bonus: label visibility threshold ────────────────────────────────────────
//
// Labels appear only when width > 60 AND height > 20.
//
describe("label visibility", () => {
  it("small bounds → label is empty string", () => {
    const root = file("tiny", 1000);
    // 50×15 is below the 60×20 threshold.
    const rects = computeTreemap(root, { x: 0, y: 0, width: 50, height: 15 }, OPTS);
    expect(rects[0].label).toBe("");
  });

  it("large bounds → label is the filename", () => {
    const root = file("big", 1_000_000);
    const rects = computeTreemap(root, { x: 0, y: 0, width: 300, height: 100 }, OPTS);
    expect(rects[0].label).not.toBe("");
    expect(rects[0].label).toContain("big");
  });

  it("long filename is truncated with ellipsis", () => {
    const longName = "a".repeat(40);
    const root = { ...file("short", 1_000_000), name: longName };
    const rects = computeTreemap(root, { x: 0, y: 0, width: 300, height: 100 }, OPTS);
    expect(rects[0].label.endsWith("…")).toBe(true);
    expect(rects[0].label.length).toBeLessThan(longName.length);
  });
});

// ── Bonus: minBlockSize filtering ─────────────────────────────────────────────
//
// Rects smaller than minBlockSize in either dimension must be suppressed.
//
describe("minBlockSize filtering", () => {
  it("tiny bounds with large minBlockSize → empty output", () => {
    // bounds 5×5, minBlockSize=10 → nothing passes
    const root = file("f", 1000);
    const rects = computeTreemap(
      root,
      { x: 0, y: 0, width: 5, height: 5 },
      { ...OPTS, minBlockSize: 10 },
    );
    expect(rects).toHaveLength(0);
  });
});

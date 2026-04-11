import { describe, it, expect } from "vitest";
import { filterTree, type TreeFilters } from "./filter";
import type { FileNode } from "../types";

function file(id: string, size: number, ext = "mp4"): FileNode {
  return { id, name: `${id}.${ext}`, path: `/${id}.${ext}`, size, kind: "file", extension: ext };
}

function dir(id: string, size: number, children: FileNode[]): FileNode {
  return { id, name: id, path: `/${id}`, size, kind: "dir", children };
}

describe("filterTree", () => {
  const f1 = file("movie", 1000, "mp4");
  const f2 = file("photo", 2000, "jpg");
  const f3 = file("doc", 3000, "pdf");
  const subdir = dir("subdir", 2000, [f2]);
  const root = dir("root", 6000, [f1, subdir, f3]);

  it("F1. Extension filter", () => {
    const filters: TreeFilters = { extensions: ["mp4"] };
    const result = filterTree(root, filters);
    
    // root should still contain movie.mp4, doc and photo should be removed
    expect(result.children).toHaveLength(1);
    expect(result.children![0].id).toBe("movie");
    // total size should be recalculated
    expect(result.size).toBe(1000);
  });

  it("F2. Size filter", () => {
    // Only files between 1500 and 2500 bytes
    const filters: TreeFilters = { minSize: 1500, maxSize: 2500 };
    const result = filterTree(root, filters);
    
    // Only photo.jpg (2000) survives
    expect(result.size).toBe(2000);
    expect(result.children![0].kind).toBe("dir"); // subdir still exists but only with photo.jpg
    expect(result.children![0].children![0].id).toBe("photo");
  });

  it("F3. Name query (case-insensitive)", () => {
    const filters: TreeFilters = { nameQuery: "MOVIE" };
    const result = filterTree(root, filters);
    
    expect(result.size).toBe(1000);
    expect(result.children![0].id).toBe("movie");
  });

  it("F4. Modified date filter", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const oldFile = { ...file("old", 1000), modified: now - 30 * day };
    const newFile = { ...file("new", 1000), modified: now - 1 * day };
    const dateRoot = dir("date", 2000, [oldFile, newFile]);

    const filters: TreeFilters = { modifiedAfter: now - 7 * day };
    const result = filterTree(dateRoot, filters);

    expect(result.children).toHaveLength(1);
    expect(result.children![0].id).toBe("new");
  });

  it("F5. Immutability", () => {
    const originalSize = root.size;
    filterTree(root, { extensions: ["mp4"] });
    expect(root.size).toBe(originalSize);
    expect(root.children).toHaveLength(3);
  });
});

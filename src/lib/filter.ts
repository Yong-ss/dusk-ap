import type { FileNode } from "../types";

export interface TreeFilters {
  extensions?: string[];      // e.g. ['mp4', 'mkv']
  minSize?: number;           // bytes
  maxSize?: number;           // bytes
  nameQuery?: string;         // substring match (case insensitive)
  modifiedAfter?: number;     // unix timestamp
  modifiedBefore?: number;    // unix timestamp
}

/**
 * Recursively filters the tree based on the provided criteria.
 * - Directories are included if any of their children match.
 * - Directory sizes are re-calculated to be the sum of their matching children.
 * - Returns a new immutable tree or null if nothing matches.
 */
export function filterTree(root: FileNode, filters: TreeFilters): FileNode | null {
  // Base case: file
  if (root.kind === "file") {
    if (filters.nameQuery && !root.name.toLowerCase().includes(filters.nameQuery.toLowerCase())) return null;
    if (filters.minSize !== undefined && root.size < filters.minSize) return null;
    if (filters.maxSize !== undefined && root.size > filters.maxSize) return null;
    
    if (filters.extensions && filters.extensions.length > 0) {
      const ext = root.extension?.toLowerCase() || "";
      if (!filters.extensions.includes(ext)) {
        return null;
      }
    }
    
    if (filters.modifiedAfter !== undefined && (!root.modified || root.modified < filters.modifiedAfter)) return null;
    if (filters.modifiedBefore !== undefined && (!root.modified || root.modified > filters.modifiedBefore)) return null;

    return { ...root };
  }

  // Recursive case: directory
  if (!root.children || root.children.length === 0) {
    // Empty folder matches nothing
    return null;
  }

  const filteredChildren: FileNode[] = [];
  let newDirSize = 0;

  for (const child of root.children) {
    const filteredChild = filterTree(child, filters);
    if (filteredChild) {
      filteredChildren.push(filteredChild);
      newDirSize += filteredChild.size;
    }
  }

  if (filteredChildren.length === 0) {
    return null; // Dir has no matching descendants
  }

  return {
    ...root,
    size: newDirSize,
    children: filteredChildren,
  };
}

/** Helper to generate a flat list of all files in a tree, sorted by size descending. */
export function getFlattenedFiles(root: FileNode | null): FileNode[] {
  const result: FileNode[] = [];
  
  function walk(node: FileNode) {
    if (node.kind === "file") {
      result.push(node);
    } else if (node.children) {
      for (const child of node.children) walk(child);
    }
  }

  if (root) walk(root);
  return result.sort((a, b) => b.size - a.size);
}

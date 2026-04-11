import React, { useRef, useEffect, useState } from 'react';
import { FileNode } from '../types';

interface TreemapCanvasProps {
  viewRoot: FileNode | null;
  onNodeClick: (node: FileNode) => void;
}

interface RectInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  node: FileNode;
  color: string;
}

const COLORS = [
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#06b6d4', // Cyan
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#3b82f6', // Blue
];

function getColor(name: string, isFile: boolean, ext?: string | null): string {
  if (!isFile) return '#1e293b'; // Base folder color
  // Simple hash for consistent colors
  let hash = 0;
  const key = ext || name;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

// Slice and Dice Treemap Algorithm
function computeLayout(
  node: FileNode,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  maxDepth: number,
  rects: RectInfo[]
) {
  if (!node.children || node.children.length === 0 || depth >= maxDepth) {
    if (w >= 1 && h >= 1) {
      rects.push({ x, y, w, h, node, color: getColor(node.name, node.kind === 'file', node.extension) });
    }
    return;
  }

  // Draw the parent directory background slightly inset if depth > 0
  const padding = depth === 0 ? 0 : 2;
  const contentX = x + padding;
  const contentY = y + padding;
  const contentW = Math.max(0, w - padding * 2);
  const contentH = Math.max(0, h - padding * 2);

  // If the available space is too small to recurse with padding, render this directory as a solid block.
  if (contentW <= 2 || contentH <= 2) {
     if (w >= 1 && h >= 1) {
         rects.push({ x, y, w, h, node, color: getColor(node.name, false, null) });
     }
     return;
  }

  const totalSize = node.size || 1;
  
  // Sort children by size descending for better visual distribution
  const sorted = [...node.children].sort((a, b) => (b.size || 0) - (a.size || 0));

  const totalChildrenSize = sorted.reduce((sum, c) => sum + (c.size || 0), 0);
  const remainingSize = totalSize - totalChildrenSize;
  
  if (remainingSize > totalSize * 0.0001) {
    sorted.push({
      id: node.id + '_files',
      name: '<Files>',
      size: remainingSize,
      kind: 'file' as any, // Visual trick to color it differently
      path: node.path + '\\<Files>',
    });
    // Re-sort with files included
    sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
  }

  let currentX = contentX;
  let currentY = contentY;

  for (let i = 0; i < sorted.length; i++) {
    const child = sorted[i];
    const fraction = (child.size || 0) / totalSize;
    if (fraction < 0.0001) continue; // Skip tiny specks

    let childW, childH;
    
    // Split along the longest dimension
    if (contentW > contentH) {
      childW = contentW * fraction;
      childH = contentH;
      computeLayout(child, currentX, currentY, childW, childH, depth + 1, maxDepth, rects);
      currentX += childW;
    } else {
      childW = contentW;
      childH = contentH * fraction;
      computeLayout(child, currentX, currentY, childW, childH, depth + 1, maxDepth, rects);
      currentY += childH;
    }
  }
}

export default function TreemapCanvas({ viewRoot, onNodeClick }: TreemapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<RectInfo[]>([]);
  const [hoveredNode, setHoveredNode] = useState<RectInfo | null>(null);

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!canvasRef.current || dimensions.width === 0 || dimensions.height === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    if (!viewRoot) {
      // CLEAR the canvas if no root is present (e.g., between scans)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);
      setRects([]);
      return;
    }
    
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;

    ctx.scale(dpr, dpr);

    // Compute layout
    let newRects: RectInfo[] = [];
    const t0 = performance.now();
    computeLayout(viewRoot, 0, 0, dimensions.width, dimensions.height, 0, 4, newRects);
    setRects(newRects);
    console.log(`[Treemap] Layout calculated in ${performance.now() - t0}ms, ${newRects.length} elements`);

    // Draw
    ctx.fillStyle = '#0f172a'; // Base background
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    for (const info of newRects) {
      ctx.fillStyle = info.color;
      ctx.fillRect(Math.floor(info.x), Math.floor(info.y), Math.max(1, Math.floor(info.w) - 1), Math.max(1, Math.floor(info.h) - 1));
    }
  }, [viewRoot, dimensions]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!canvasRef.current || rects.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Optimize later with a spatial index if needed, linear search is fine for < 10k rects
    let found = null;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        found = r;
        break;
      }
    }
    setHoveredNode(found);
  };

  const handleMouseClick = () => {
    if (hoveredNode && hoveredNode.node.kind === 'dir') {
      onNodeClick(hoveredNode.node);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    const k = bytes / 1024;
    if (k < 1024) return k.toFixed(1) + ' KB';
    const m = k / 1024;
    if (m < 1024) return m.toFixed(1) + ' MB';
    return (m / 1024).toFixed(2) + ' GB';
  };

  return (
    <div className="relative w-full h-full" ref={containerRef}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredNode(null)}
        onClick={handleMouseClick}
        className="absolute inset-0 cursor-pointer"
      />
      
      {/* Tooltip */}
      {hoveredNode && (
        <div 
          className="pointer-events-none absolute z-50 bg-gray-900/90 backdrop-blur border border-gray-700 px-3 py-2 rounded-lg shadow-xl text-xs"
          style={{
            left: Math.min(hoveredNode.x + 10, (containerRef.current?.clientWidth || Number.MAX_VALUE) - 200),
            top: Math.min(hoveredNode.y + 10, (containerRef.current?.clientHeight || Number.MAX_VALUE) - 60),
          }}
        >
          <div className="font-bold text-white truncate max-w-[200px]">{hoveredNode.node.name}</div>
          <div className="text-gray-400 mt-0.5">{formatSize(hoveredNode.node.size || 0)}</div>
        </div>
      )}
    </div>
  );
}

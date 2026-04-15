import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileNode } from '../types';
import { formatBytes } from '../lib/format';
import ContextMenu, { ContextMenuState } from './ContextMenu';

interface FileListProps {
  files: FileNode[];
  parentSize: number; // To show relative progress bars
  fileCount: number;
  dirCount: number;
}

export default function FileList({ files, parentSize, fileCount, dirCount }: FileListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36, // 36px row height
    overscan: 10,
  });

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm font-mono italic p-4">
        No files in this directory.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900/50 backdrop-blur-sm border-l border-gray-800">
      {/* Folder Stats Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-950/40 border-b border-gray-800/50 shrink-0">
        <div className="flex gap-4">
          <div className="flex flex-col">
            <span className="text-[9px] uppercase font-black text-gray-600 leading-none mb-1">Directories</span>
            <span className="text-sm font-mono font-bold text-blue-400">{dirCount}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] uppercase font-black text-gray-600 leading-none mb-1">Files</span>
            <span className="text-sm font-mono font-bold text-emerald-400">{fileCount}</span>
          </div>
        </div>
        <div className="text-[10px] font-bold text-gray-700 uppercase tracking-tighter">
          ACTIVE FOLDER
        </div>
      </div>

      {/* Table Header */}
      <div className="flex items-center px-4 py-2 text-xs font-bold text-gray-400 uppercase tracking-widest border-b border-gray-800 shadow-md bg-gray-950/80 shrink-0">
        <div className="flex-1 truncate">Name</div>
        <div className="w-24 text-right shrink-0">Type</div>
        <div className="w-32 text-right shrink-0">Size</div>
      </div>

      {/* Virtualized Body */}
      <div 
        ref={parentRef} 
        className="flex-1 overflow-auto custom-scrollbar relative"
        style={{ contain: 'strict' }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const file = files[virtualRow.index];
            const sizeRatio = parentSize > 0 ? (file.size / parentSize) * 100 : 0;
            
            // Extract extension safely
            const extMatch = file.name.match(/\.([^.]+)$/);
            const ext = extMatch ? extMatch[1].toUpperCase() : 'FILE';

            return (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 w-full flex items-center px-4 text-xs hover:bg-gray-800/50 transition-colors border-b border-gray-800/30 group"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (file.path) setCtxMenu({ x: e.clientX, y: e.clientY, path: file.path, name: file.name, size: file.size });
                }}
              >
                {/* Size Visualizer Bar (Background) */}
                <div 
                  className="absolute left-0 bottom-0 top-0 bg-emerald-900/10 transition-all z-0"
                  style={{ width: `${Math.min(100, Math.max(0, sizeRatio))}%` }}
                />

                <div className="flex-1 min-w-0 pr-4 relative z-10 flex items-center gap-2">
                  <span className="text-gray-500 text-sm">📄</span>
                  <div className="text-gray-200 truncate font-medium group-hover:text-emerald-400 transition-colors flex-1">
                    {file.name}
                  </div>
                </div>
                <div className="w-24 text-right shrink-0 text-gray-500 relative z-10 font-mono text-[10px]">
                  {ext}
                </div>
                <div className="w-32 text-right shrink-0 text-emerald-400 font-mono font-bold tracking-tight relative z-10">
                  {formatBytes(file.size)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}

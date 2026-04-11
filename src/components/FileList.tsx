import React, { useMemo } from 'react';
import { FileNode } from '../types';
import { formatBytes, formatCount } from '../lib/format';

interface FileListProps {
  viewRoot: FileNode | null;
  onDirClick: (node: FileNode) => void;
}

const FileList: React.FC<FileListProps> = ({ viewRoot, onDirClick }) => {
  const nodes = viewRoot?.children || [];

  const sortedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => {
      // Directories first
      if (a.kind !== b.kind) {
        return a.kind === 'dir' ? -1 : 1;
      }
      // Then by size descending
      return b.size - a.size;
    });
  }, [nodes]);

  const visibleNodes = sortedNodes.slice(0, 200);
  const totalCount = nodes.length;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950 text-gray-300 select-none">
      <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900/50 backdrop-blur-sm">
        <h2 className="text-sm font-medium flex items-center gap-2">
          {viewRoot?.name || 'Scan Index'}
          <span className="text-[10px] text-gray-600 bg-gray-950 px-1.5 py-0.5 rounded border border-gray-800 font-mono">
            {formatCount(totalCount)} items
          </span>
        </h2>
        {totalCount > 200 && (
          <span className="text-[10px] text-gray-600 italic">Showing top 200 of {formatCount(totalCount)} results</span>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto font-mono text-xs custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-gray-950 z-10 shadow-sm border-b border-gray-800">
            <tr className="text-gray-500 uppercase tracking-wider text-[10px]">
              <th className="px-4 py-2 font-normal">Name</th>
              <th className="px-4 py-2 font-normal text-right w-32">Size</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-900/50">
            {visibleNodes.map((node) => (
              <tr 
                key={node.id} 
                className="hover:bg-gray-900 transition-colors group cursor-pointer"
                onClick={() => node.kind === 'dir' && onDirClick(node)}
              >
                <td className="px-4 py-2 flex items-center gap-2 truncate">
                  <span className="text-lg opacity-60 group-hover:opacity-100 transition-opacity">
                    {node.kind === 'dir' ? '📁' : '📄'}
                  </span>
                  <span className="truncate max-w-[400px]" title={node.name}>
                    {node.name.length > 40 ? node.name.slice(0, 40) + '...' : node.name}
                  </span>
                  {node.kind === 'dir' && node.children && (
                     <span className="text-[9px] text-gray-600 font-bold group-hover:text-blue-500 transition-colors">
                        ({node.children.length})
                     </span>
                  )}
                </td>
                <td className={`px-4 py-2 text-right whitespace-nowrap transition-colors font-bold ${node.kind === 'dir' ? 'text-blue-400 group-hover:text-blue-300' : 'text-emerald-400 group-hover:text-emerald-300'}`}>
                  {formatBytes(node.size)}
                  {node.extension && (
                    <span className="ml-2 text-[9px] text-gray-700 uppercase">{node.extension.slice(1)}</span>
                  )}
                </td>
              </tr>
            ))}
            {totalCount === 0 && !viewRoot && (
              <tr>
                <td colSpan={2} className="py-32 text-center text-gray-600">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-4xl opacity-20 animate-pulse">🛰️</span>
                    <p className="text-lg font-medium opacity-50">Mapping Structures</p>
                    <p className="text-sm opacity-40">Connecting parent-child hierarchies...</p>
                  </div>
                </td>
              </tr>
            )}
            {totalCount === 0 && viewRoot && (
              <tr>
                <td colSpan={2} className="py-24 text-center text-gray-600 font-mono italic opacity-50">
                  Directory is empty
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FileList;

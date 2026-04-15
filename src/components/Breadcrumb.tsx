import React from 'react';

interface BreadcrumbProps {
  path: string;
  onSegmentClick: (path: string) => void;
}

const Breadcrumb: React.FC<BreadcrumbProps> = ({ path, onSegmentClick }) => {
  // Normalize path and split
  const isWindows = path.includes(':');
  const segments = path.split(/[/\\]/).filter(Boolean);
  
  // In Windows, segments[0] is usually "C:"
  // In Unix, segments are just directories
  
  return (
    <div className="flex items-center gap-1 px-4 py-1.5 text-[10px] font-mono text-gray-500 bg-gray-950/50 border-b border-gray-800/50 overflow-x-auto whitespace-nowrap no-scrollbar select-none">
      <button 
        onClick={() => onSegmentClick(isWindows ? (segments[0] ?? '') + '\\' : '/')}
        className="hover:text-emerald-400 transition-colors uppercase font-bold tracking-tighter"
      >
        ROOT
      </button>
      
      {segments.map((segment, index) => {
        // Build subpath
        let subPath = '';
        if (isWindows) {
          subPath = segments.slice(0, index + 1).join('\\');
          // If it's just "C:", make it "C:\"
          if (subPath.length === 2 && subPath.endsWith(':')) subPath += '\\';
        } else {
          subPath = '/' + segments.slice(0, index + 1).join('/');
        }
          
        return (
          <React.Fragment key={subPath}>
            <span className="opacity-20 mx-0.5">/</span>
            <button
              onClick={() => onSegmentClick(subPath)}
              className="hover:text-emerald-400 transition-colors max-w-[120px] truncate"
              title={subPath}
            >
              {segment}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default Breadcrumb;

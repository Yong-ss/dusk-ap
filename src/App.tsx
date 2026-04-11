import React, { useState, useEffect, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useScan } from './hooks/useScan';
import FileList from './components/FileList';
import Breadcrumb from './components/Breadcrumb';
import { formatCount, getParentPath, formatBytes } from './lib/format';
import { FileNode } from './types';

const App: React.FC = () => {
  const { 
    isScanning, progress, rootNode, treeMap, 
    startScan, cancelScan, 
    elapsedTime, duration, estimatedTotalSize 
  } = useScan();
  
  const [scanPath, setScanPath] = useState<string | null>(null);
  const [currentViewId, setCurrentViewId] = useState<string | null>(null);

  const viewNode = currentViewId ? treeMap.get(currentViewId) : rootNode;

  const handleScan = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Folder to Scan',
      });

      if (selected && typeof selected === 'string') {
        setScanPath(selected);
        setCurrentViewId(null);
        await startScan(selected);
      }
    } catch (err) {
      console.error('Dialog error:', err);
    }
  };

  const handleDirClick = (node: FileNode) => {
    setCurrentViewId(node.path);
  };

  const handleGoUp = useCallback(() => {
    if (!viewNode || viewNode.path === scanPath) return;
    const parentPath = getParentPath(viewNode.path);
    setCurrentViewId(parentPath);
  }, [viewNode, scanPath]);

  const handleBreadcrumbClick = (path: string) => {
    setCurrentViewId(path);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace') handleGoUp();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleGoUp]);

  // Hybrid Progress Logic
  let progressPercent: number | null = null;
  let progressLabel = 'Scanning...';
  
  if (progress?.totalRecords && progress?.processedRecords) {
    // Case 1: MFT (accurate count)
    progressPercent = Math.min(100, Math.round((progress.processedRecords / progress.totalRecords) * 100));
    progressLabel = `Analyzing MFT Index ${progressPercent}%`;
  } else if (estimatedTotalSize && progress?.total_size) {
    // Case 2: Volume Root Heuristic (used space)
    progressPercent = Math.min(100, Math.round((progress.total_size / estimatedTotalSize) * 100));
    progressLabel = `Probing Volume ${progressPercent}%`;
  } else if (isScanning) {
    // Case 3: Subdirectory (Indeterminate)
    progressPercent = null;
    progressLabel = `Discovering items...`;
  }

  const formatMs = (ms: number) => (ms / 1000).toFixed(1) + 's';

  return (
    <div className="flex h-screen bg-gray-950 text-white font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col pt-6 shrink-0">
        <div className="px-6 mb-8 group cursor-default">
          <h1 className="text-2xl font-black tracking-tighter text-white group-hover:text-emerald-400 transition-colors">Dusk</h1>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1 font-bold">Disk Space Analyzer</p>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <button
            onClick={handleScan}
            disabled={isScanning}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all shadow-lg ${
              isScanning 
                ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700' 
                : 'bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white shadow-emerald-700/20'
            }`}
          >
            <span className="text-lg">{isScanning ? '⏳' : '🔍'}</span>
            <span>{isScanning ? 'Working...' : 'Scan Folder'}</span>
          </button>

          {isScanning && (
            <button
              onClick={cancelScan}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold bg-red-950/20 hover:bg-red-900/30 text-red-500 transition-all border border-red-900/20 active:scale-[0.98]"
            >
              <span className="text-lg">⏹</span>
              <span>Cancel Scan</span>
            </button>
          )}
        </nav>

        {scanPath && (
          <div className="p-4 border-t border-gray-800 bg-gray-950/30">
            <p className="text-[9px] text-gray-500 uppercase font-bold mb-1 tracking-wider">Target Target</p>
            <p className="text-[11px] truncate text-gray-400 font-mono leading-tight" title={scanPath}>{scanPath}</p>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {viewNode && (
          <Breadcrumb 
            path={viewNode.path} 
            onSegmentClick={handleBreadcrumbClick} 
          />
        )}
        
        <FileList 
          viewRoot={viewNode || null} 
          onDirClick={handleDirClick} 
        />

        {/* Improved Status Bar */}
        {(isScanning || (progress?.scanned || 0) > 0) && (
          <div className="absolute bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-xl border-t border-gray-800 px-6 py-4 flex flex-col gap-3 z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.6)]">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-4 min-w-0">
                <span className="flex items-center gap-2 shrink-0">
                  <span className={`w-2 h-2 rounded-full ${isScanning ? 'bg-emerald-500 animate-pulse' : 'bg-gray-600'}`}></span>
                  <span className="font-bold uppercase tracking-wider">
                    {isScanning ? progressLabel : `Scan Finished in ${formatMs(duration || elapsedTime)}`}
                  </span>
                </span>
                <span className="text-gray-800 shrink-0">|</span>
                <span className="text-gray-500 truncate font-mono italic" title={progress?.current_path}>
                   {isScanning ? (progress?.current_path || 'Initializing stream...') : `Processed ${formatCount(progress?.scanned || 0)} objects`}
                </span>
              </div>
              
              <div className="flex gap-4 shrink-0 font-mono">
                <div className="text-right">
                  <p className="text-gray-600 uppercase text-[8px] font-black leading-none mb-0.5">Objects</p>
                  <p className="text-white font-bold">{formatCount(progress?.scanned || 0)}</p>
                </div>
                <div className="text-right min-w-[60px]">
                  <p className="text-gray-600 uppercase text-[8px] font-black leading-none mb-0.5">Size</p>
                  <p className="text-emerald-400 font-bold">{formatBytes(progress?.total_size || 0)}</p>
                </div>
                <div className="text-right min-w-[50px]">
                  <p className="text-gray-600 uppercase text-[8px] font-black leading-none mb-0.5">Time</p>
                  <p className="text-blue-400 font-bold">{formatMs(elapsedTime)}</p>
                </div>
              </div>
            </div>

            {isScanning && (
              <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden relative">
                <div 
                  className={`absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-700 ease-in-out shadow-[0_0_12px_rgba(16,185,129,0.5)] ${!progressPercent ? 'animate-progress-indeterminate' : ''}`}
                  style={{ 
                    width: progressPercent ? `${progressPercent}%` : '40%',
                  }}
                />
              </div>
            )}
          </div>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes progress-indeterminate {
          0% { left: -40%; width: 40%; }
          50% { width: 60%; }
          100% { left: 100%; width: 40%; }
        }
        .animate-progress-indeterminate {
          animation: progress-indeterminate 1.8s infinite ease-in-out;
        }
      `}} />
    </div>
  );
};

export default App;

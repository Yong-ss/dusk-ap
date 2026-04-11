import { AnimatePresence, motion } from "framer-motion";
import { useState, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTheme } from "./components/ThemeProvider";
import { useScan } from "./hooks/useScan";
import TreemapCanvas from "./components/TreemapCanvas";
import { formatBytes, formatCount } from "./lib/format";
import Tooltip from "./components/Tooltip";
import ContextMenu, { ContextMenuState } from "./components/ContextMenu";
import { computeTreemap } from "./lib/treemap";
import { DEFAULT_COLOR_MAP } from "./lib/colormap";
import type { FileNode, TreemapRect } from "./types";
import { useFilter } from "./hooks/useFilter";
import { filterTree } from "./lib/filter";
import FilterBar from "./components/FilterBar";
import TopFilesPanel from "./components/TopFilesPanel";
import SettingsPanel from "./components/SettingsPanel";
import { useSettings } from "./hooks/useSettings";

// ── Static sidebar data ───────────────────────────────────────────────────────

const QUICK_ACCESS = [
  { label: "C:\\", abbr: "C:" },
  { label: "D:\\Media", abbr: "D:" },
  { label: "Downloads", abbr: "Dl" },
];

interface DriveInfo {
  name: string;
  mount_point: string;
  total_space: number;
  available_space: number;
}

interface RecentScan {
  path: string;
  time: number;
  size: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { cycleTheme, resolvedTheme, themeMode } = useTheme();
  
  const { settings, setSettings } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { startScan: rawStartScan, cancelScan, tree, progress, isScanning, error } = useScan();

  // Settings-aware startScan wrapper
  const startScan = async (path: string) => {
    await rawStartScan(path, settings);
  };

  // ── Phase 5 State ───────────────────────────────────────────────────────────

  const [viewHistory, setViewHistory] = useState<FileNode[]>([]);
  const viewRoot = viewHistory.length > 0 ? viewHistory[viewHistory.length - 1] : tree;

  const [hoveredRect, setHoveredRect] = useState<TreemapRect | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const mainRef = useRef<HTMLElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });

  // ── Phase 6 State ───────────────────────────────────────────────────────────
  const { filters, setFilters, clearFilters, activeCount } = useFilter();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [topFilesOpen, setTopFilesOpen] = useState(false);

  // ── Phase 7 Sidebar & Storage ───────────────────────────────────────────────
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);

  const fetchDrives = async () => {
    try {
      const res = await invoke<DriveInfo[]>("get_drives");
      setDrives(res);
    } catch (e) {
      console.error("Failed to fetch drives", e);
    }
  };

  useEffect(() => {
    fetchDrives();
    try {
      const storedScans = localStorage.getItem("dusk_recent_scans");
      if (storedScans) setRecentScans(JSON.parse(storedScans));
    } catch {}
  }, []);

  // Update recent scans when a scan finishes successfully
  useEffect(() => {
    if (!isScanning && progress?.done && tree) {
      setRecentScans(prev => {
        const item = { path: tree.path, time: Date.now(), size: progress.total_size };
        const filtered = prev.filter(r => r.path !== item.path);
        const next = [item, ...filtered].slice(0, 5);
        localStorage.setItem("dusk_recent_scans", JSON.stringify(next));
        return next;
      });
    }
  }, [isScanning, progress?.done, tree]);

  // Keyboard bindings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+F or Ctrl+F
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault(); 
        searchInputRef.current?.focus();
      }
      // Cmd+, or Ctrl+, for Settings
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(s => !s);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleScanDialog() {
    if (isScanning) {
      await cancelScan();
      return;
    }

    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose a folder to scan",
    });

    if (typeof selected === "string" && selected.length > 0) {
      setViewHistory([]); // Reset drill-down on new scan
      setContextMenu(null);
      await startScan(selected);
    }
  }

  // ── Size & Treemap Calculation ──────────────────────────────────────────────

  useEffect(() => {
    if (!mainRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width && height) {
        setBounds({ width, height });
      }
    });
    ro.observe(mainRef.current);
    return () => ro.disconnect();
  }, []);

  const filteredViewRoot = useMemo(() => {
    if (!viewRoot) return null;
    return filterTree(viewRoot, filters);
  }, [viewRoot, filters]);

  const rects = useMemo(() => {
    if (!filteredViewRoot || bounds.width === 0 || bounds.height === 0) return undefined;
    
    return computeTreemap(
      filteredViewRoot,
      { x: 0, y: 0, width: bounds.width, height: bounds.height },
      { colorMap: DEFAULT_COLOR_MAP, minBlockSize: settings.minBlockSize }
    );
  }, [filteredViewRoot, bounds]);

  // ── Interactions ────────────────────────────────────────────────────────────

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (hoveredRect) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, rect: hoveredRect });
    }
  };

  const [lastClick, setLastClick] = useState<{ id: string; time: number } | null>(null);
  const handleRectClick = (rect: TreemapRect) => {
    const now = Date.now();
    if (lastClick && lastClick.id === rect.id && now - lastClick.time < 300) {
      // Double click
      if (rect.kind === "dir") {
        if (viewRoot?.children) {
           const node = viewRoot.children.find(n => n.id === rect.id);
           if (node) {
             setViewHistory([...viewHistory, node]);
             setContextMenu(null);
             setHoveredRect(null);
           }
        }
      }
      setLastClick(null);
    } else {
      setLastClick({ id: rect.id, time: now });
    }
  };

  const handleCrumbClick = (index: number) => {
    if (index === -1) {
      setViewHistory([]); // Go to root
    } else {
      setViewHistory(viewHistory.slice(0, index + 1));
    }
    setContextMenu(null);
    setHoveredRect(null);
  };

  // Backspace keybinding for popping view history
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't pop if context menu or settings or top files is open, or focused input
      if (e.key === "Backspace" && viewHistory.length > 0 && !contextMenu && !settingsOpen && !topFilesOpen) {
        if (document.activeElement?.tagName === "INPUT") return;
        setViewHistory((prev) => prev.slice(0, -1));
        setHoveredRect(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewHistory.length, contextMenu, settingsOpen, topFilesOpen]);

  // ── Derived display values ───────────────────────────────────────────────────

  const scanButtonLabel = isScanning ? "Cancel Scan" : "Scan Folder";
  const scanButtonClass = isScanning
    ? "rounded-full bg-red-600/80 px-5 py-2 text-sm font-semibold text-white shadow-lg hover:brightness-110"
    : "rounded-full bg-[rgb(var(--accent-video))] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 hover:brightness-110";

  const activeCrumbs = [
    { name: tree?.path || "No scan active", index: -1 }
  ];
  viewHistory.forEach((node, i) => {
    activeCrumbs.push({ name: node.name, index: i });
  });

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen overflow-hidden bg-app text-primary">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(99,102,241,0.18),transparent_26%),radial-gradient(circle_at_80%_0%,rgba(16,185,129,0.12),transparent_22%),linear-gradient(180deg,rgba(15,23,42,0.22),transparent_40%)]" />

      <div className="relative flex min-h-screen p-4">
        {/* ── Sidebar ── */}
        <motion.aside
          animate={{ width: sidebarCollapsed ? 88 : 256 }}
          className="glass-panel relative flex shrink-0 flex-col overflow-hidden rounded-[28px]"
          transition={{ duration: 0.25, ease: "easeInOut" }}
        >
          <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
            <div className={sidebarCollapsed ? "hidden" : "block"}>
              <p className="text-xs uppercase tracking-[0.35em] text-muted">
                Dusk
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                Disk Atlas
              </h1>
            </div>

            <button
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="rounded-full border border-border-soft bg-white/10 p-2 text-sm text-primary hover:bg-white/15 focus:ring-2 focus:ring-indigo-500/50 outline-none"
              onClick={() => setSidebarCollapsed((v) => !v)}
              type="button"
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
            {/* Storage Drives */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className={`text-xs uppercase tracking-[0.3em] text-muted ${sidebarCollapsed ? "sr-only" : ""}`}>
                  Drives
                </p>
                {!sidebarCollapsed && (
                  <button onClick={fetchDrives} className="text-xs text-muted hover:text-primary transition-colors">⟳</button>
                )}
              </div>
              <motion.div 
                className="space-y-2"
                initial="hidden"
                animate="visible"
                variants={{
                  hidden: { opacity: 0 },
                  visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
                }}
              >
                {drives.map(drive => {
                  const usedItem = drive.total_space - drive.available_space;
                  const ratio = usedItem / drive.total_space;
                  return (
                    <motion.button
                      variants={{ hidden: { opacity: 0, y: 5 }, visible: { opacity: 1, y: 0 } }}
                      key={drive.mount_point}
                      onClick={() => {
                        setViewHistory([]);
                        void startScan(drive.mount_point);
                      }}
                      className="w-full text-left rounded-2xl border border-transparent bg-white/5 p-3 hover:border-border-soft hover:bg-white/10 transition-colors focus:ring-2 focus:ring-indigo-500/50 outline-none"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900/70 text-[11px] font-semibold text-slate-100">
                          {drive.mount_point.replace(/\\/g, '')}
                        </span>
                        {!sidebarCollapsed && (
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-sm font-medium">{drive.name}</p>
                            <p className="text-[10px] text-muted font-mono">{formatBytes(drive.available_space)} free of {formatBytes(drive.total_space)}</p>
                          </div>
                        )}
                      </div>
                      {!sidebarCollapsed && (
                        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-black/40">
                          <div className="h-full bg-indigo-500" style={{ width: `${ratio * 100}%` }} />
                        </div>
                      )}
                    </motion.button>
                  );
                })}
              </motion.div>
            </section>

            {/* Quick Access */}
            <section>
              <p
                className={`mb-3 text-xs uppercase tracking-[0.3em] text-muted ${sidebarCollapsed ? "sr-only" : ""}`}
              >
                Quick Access
              </p>
              <div className="space-y-2">
                {QUICK_ACCESS.map((item) => (
                  <button
                    key={item.label}
                    className="flex w-full items-center gap-3 rounded-2xl border border-transparent bg-white/5 px-3 py-3 text-left text-sm text-primary hover:border-border-soft hover:bg-white/10 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-colors"
                    onClick={() => {
                      setViewHistory([]);
                      void startScan(item.label);
                    }}
                    type="button"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900/70 text-[11px] font-semibold text-slate-100">
                      {item.abbr}
                    </span>
                    {!sidebarCollapsed && (
                      <span className="truncate text-sm">{item.label}</span>
                    )}
                  </button>
                ))}
              </div>
            </section>

            {/* Recent Scans */}
            {recentScans.length > 0 && !sidebarCollapsed && (
              <section>
                <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
                  Recent Scans
                </p>
                <div className="space-y-1">
                  {recentScans.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setViewHistory([]);
                        void startScan(r.path);
                      }}
                      className="group flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-colors"
                    >
                      <div className="flex flex-col text-left truncate flex-1 min-w-0 mr-2">
                        <span className="truncate text-xs text-primary">{r.path}</span>
                        <span className="text-[10px] text-muted font-mono">{new Date(r.time).toLocaleDateString()}</span>
                      </div>
                      <span className="text-[10px] font-mono text-indigo-300 opacity-60 group-hover:opacity-100 shrink-0">
                        {formatBytes(r.size)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="border-t border-border-soft px-4 py-4 flex flex-col gap-2">
            <button
              className="flex w-full items-center justify-between rounded-2xl border border-border-soft bg-white/5 px-4 py-3 text-sm hover:bg-white/10 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-colors"
              onClick={() => setSettingsOpen(true)}
              type="button"
            >
              {!sidebarCollapsed ? (
                <>
                  <span>Settings</span>
                  <span className="text-muted text-xs border border-white/10 rounded px-1.5 py-0.5">⌘,</span>
                </>
              ) : (
                <span className="mx-auto">⚙</span>
              )}
            </button>
            <button
              className="flex w-full items-center justify-between rounded-2xl border border-border-soft bg-white/5 px-4 py-3 text-sm hover:bg-white/10 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-colors"
              onClick={cycleTheme}
              type="button"
            >
              {!sidebarCollapsed ? (
                <>
                  <span>Theme: {themeMode}</span>
                  <span className="text-muted">{resolvedTheme}</span>
                </>
              ) : (
                <span className="mx-auto">
                  {resolvedTheme === "dark" ? "◐" : "◑"}
                </span>
              )}
            </button>
          </div>
        </motion.aside>

        {/* ── Main column ── */}
        <div className="ml-4 flex min-w-0 flex-1 flex-col gap-4">
          {/* Toolbar */}
          <header className="glass-panel flex items-center justify-between rounded-[28px] px-6 py-4">
            <div className="min-w-0 flex items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-muted">
                  Workspace
                </p>
                <div className="mt-2 flex items-center gap-2 overflow-hidden text-sm text-muted">
                  {activeCrumbs.map((crumb, idx) => (
                    <span key={idx} className="flex items-center gap-2 shrink-0">
                      {idx > 0 && <span>/</span>}
                      <button 
                        onClick={() => handleCrumbClick(crumb.index)}
                        className="truncate rounded-full bg-white/5 px-3 py-1 text-primary hover:bg-white/10 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-colors max-w-[200px]"
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center flex-col items-end shrink-0 gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setTopFilesOpen(true)}
                  className="rounded-full border border-border-soft bg-white/5 px-4 py-2 text-sm text-primary hover:bg-white/10 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-colors"
                >
                  Top 50 Files
                </button>
                <AnimatePresence>
                  {isScanning && (
                    <motion.div
                      animate={{ opacity: 1 }}
                      className="text-xs text-muted"
                      exit={{ opacity: 0 }}
                      initial={{ opacity: 0 }}
                    >
                      {progress?.current_path.split(/[/\\]/).at(-1) ?? "…"}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  className={scanButtonClass}
                  id="scan-button"
                  onClick={() => void handleScanDialog()}
                  type="button"
                >
                  {scanButtonLabel}
                </button>
              </div>
              
              {!isScanning && progress?.done && (
                  <div className="text-[10px] text-muted text-right tracking-tight">
                    Finished {formatCount(progress.scanned)} files · {formatBytes(progress.total_size)}
                  </div>
              )}
            </div>
          </header>

          <FilterBar
            filters={filters}
            setFilters={setFilters}
            clearFilters={clearFilters}
            activeCount={activeCount}
            searchInputRef={searchInputRef}
          />

          {/* Main canvas area — TreemapCanvas fills this completely */}
          <main
            ref={mainRef}
            className="glass-panel relative flex min-h-[420px] flex-1 overflow-hidden rounded-[32px]"
            id="treemap-main"
            onMouseMove={handleMouseMove}
            onContextMenu={handleContextMenu}
          >
            {/* Subtle gradient overlay behind the canvas */}
            <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(99,102,241,0.10),transparent_35%),linear-gradient(315deg,rgba(6,182,212,0.09),transparent_28%)]" />

            {/* TreemapCanvas wrap with Framer Motion for drill-down animation */}
            <motion.div
              className="absolute inset-0 z-10"
              key={viewRoot?.id ?? "empty"}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <TreemapCanvas 
                rects={rects} 
                onHover={setHoveredRect} 
                onClick={handleRectClick} 
              />
            </motion.div>

            {/* Error banners & Placeholders float above canvas */}
            <AnimatePresence>
              {error && (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute left-4 right-4 top-4 z-30 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-5 py-3 text-sm text-yellow-300 backdrop-blur-sm"
                  exit={{ opacity: 0, y: -8 }}
                  initial={{ opacity: 0, y: -8 }}
                >
                  ⚠ {error}
                </motion.div>
              )}
              {!isScanning && tree && filteredViewRoot && (!filteredViewRoot.children || filteredViewRoot.children.length === 0) && (
                <motion.div
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 backdrop-blur-sm"
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                >
                  <div className="text-center">
                    <p className="text-lg font-semibold text-primary">Directory is empty</p>
                    <p className="text-sm text-muted mt-2">No matching files found here.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scan progress bar — floats at bottom of canvas */}
            <AnimatePresence>
              {isScanning && (
                <motion.div
                  animate={{ opacity: 1 }}
                  className="absolute bottom-0 left-0 right-0 z-30 h-[3px] overflow-hidden bg-white/10"
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                >
                  <motion.div
                    animate={{ x: ["0%", "100%", "0%"] }}
                    className="h-full w-1/3 bg-[rgb(var(--accent-video))]"
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scan overlay — shown while scanning, fades out when done */}
            <AnimatePresence>
              {isScanning && progress && (
                <motion.div
                  animate={{ opacity: 1 }}
                  className="pointer-events-none absolute left-4 top-4 z-30 rounded-2xl border border-border-soft bg-black/40 px-4 py-3 backdrop-blur-md"
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                >
                  <p className="text-xs uppercase tracking-[0.28em] text-muted">Scanning</p>
                  <p className="mt-1 font-mono text-sm text-primary">
                    {formatCount(progress.scanned)} files · {formatBytes(progress.total_size)}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        </div>
      </div>
      
      {/* Portals / Modals / Tooltips (rendered outside the canvas div to avoid clipping) */}
      {!contextMenu && <Tooltip rect={hoveredRect} position={mousePos} totalSize={filteredViewRoot?.size ?? 0} />}
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      
      <TopFilesPanel
        isOpen={topFilesOpen}
        onClose={() => setTopFilesOpen(false)}
        tree={tree}
        onFileClick={(_file, parentPath) => {
          let targetParent: FileNode | null = null;
          if (tree) {
            const queue = [tree];
            while (queue.length > 0) {
              const node = queue.shift()!;
              if (node.path === parentPath) {
                targetParent = node;
                break;
              }
              if (node.children) {
                for (const child of node.children) queue.push(child);
              }
            }
          }

          if (targetParent && tree) {
            setViewHistory([tree, targetParent]);
          }
          setTopFilesOpen(false);
        }}
      />

      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
      />
    </div>
  );
}

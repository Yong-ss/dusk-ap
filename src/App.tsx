import { AnimatePresence, motion } from "framer-motion";
import { useState, useRef, useEffect, useMemo } from "react";
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

// ── Static sidebar data ───────────────────────────────────────────────────────

const QUICK_ACCESS = [
  { label: "C:\\", abbr: "C:" },
  { label: "D:\\Media", abbr: "D:" },
  { label: "Downloads", abbr: "Dl" },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { cycleTheme, resolvedTheme, themeMode } = useTheme();

  const { startScan, cancelScan, tree, progress, isScanning, error } = useScan();

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

  // Keyboard binding for Ctrl+F
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+F on Mac, Ctrl+F on Windows/Linux
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault(); // Prevent native browser search
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleScan() {
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
      { colorMap: DEFAULT_COLOR_MAP }
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
      // hide tooltip when context menu is open inside UI using conditional render
    }
  };

  const [lastClick, setLastClick] = useState<{ id: string; time: number } | null>(null);
  const handleRectClick = (rect: TreemapRect) => {
    const now = Date.now();
    if (lastClick && lastClick.id === rect.id && now - lastClick.time < 300) {
      // Double click
      if (rect.kind === "dir") {
        // Find the full FileNode from the current viewRoot's children
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
      // Don't pop if context menu is open
      if (e.key === "Backspace" && viewHistory.length > 0 && !contextMenu) {
        setViewHistory((prev) => prev.slice(0, -1));
        setHoveredRect(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewHistory.length, contextMenu]);

  // ── Derived display values ───────────────────────────────────────────────────

  const scanButtonLabel = isScanning ? "Cancel Scan" : "Scan Folder";
  const scanButtonClass = isScanning
    ? "rounded-full bg-red-600/80 px-5 py-2 text-sm font-semibold text-white shadow-lg hover:brightness-110"
    : "rounded-full bg-[rgb(var(--accent-video))] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 hover:brightness-110";

  // Build the breadcrumbs sequence
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
              className="rounded-full border border-border-soft bg-white/10 p-2 text-sm text-primary hover:bg-white/15"
              onClick={() => setSidebarCollapsed((v) => !v)}
              type="button"
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
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
                    className="flex w-full items-center gap-3 rounded-2xl border border-transparent bg-white/5 px-3 py-3 text-left text-sm text-primary hover:border-border-soft hover:bg-white/10"
                    onClick={() => void startScan(item.label)}
                    type="button"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900/70 text-[11px] font-semibold uppercase text-slate-100">
                      {item.abbr}
                    </span>
                    {!sidebarCollapsed && (
                      <span className="truncate text-sm">{item.label}</span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="border-t border-border-soft px-4 py-4">
            <button
              className="flex w-full items-center justify-between rounded-2xl border border-border-soft bg-white/5 px-4 py-3 text-sm hover:bg-white/10"
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
                        className="truncate rounded-full bg-white/5 px-3 py-1 text-primary hover:bg-white/10 transition-colors max-w-[200px]"
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
                  className="rounded-full border border-border-soft bg-white/5 px-4 py-2 text-sm text-primary hover:bg-white/10 transition-colors"
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
                  onClick={() => void handleScan()}
                  type="button"
                >
                  {scanButtonLabel}
                </button>
              </div>
              
              {/* Added Scan Complete in right toolbar instead of overlaying canvas forever */}
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

            {/* TreemapCanvas fills the entire pane */}
            <TreemapCanvas 
              rects={rects} 
              onHover={setHoveredRect} 
              onClick={handleRectClick} 
            />

            {/* Error banner — floats above canvas */}
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
          // Drill down logic: find the parent directory from the full tree to set as viewRoot
          // Since find-by-path involves a recursive lookup from tree, we just do a quick breadth-first search.
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
            // this is simplified; we set the root. In Phase 5, viewHistory logic is flat or simple stack.
            // If the user clicks a file, we set the viewRoot to that file's parent.
            setViewHistory([tree, targetParent]);
          }
          setTopFilesOpen(false);
        }}
      />
    </div>
  );
}

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTheme } from "./components/ThemeProvider";
import { useScan } from "./hooks/useScan";
import TreemapCanvas from "./components/TreemapCanvas";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

// ── Static sidebar data ───────────────────────────────────────────────────────

const QUICK_ACCESS = [
  { label: "C:\\", abbr: "C:" },
  { label: "D:\\Media", abbr: "D:" },
  { label: "Downloads", abbr: "Dl" },
];

// ── Component ─────────────────────────────────────────────────────────────────

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { cycleTheme, resolvedTheme, themeMode } = useTheme();

  const { startScan, cancelScan, tree, progress, isScanning, error } =
    useScan();

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
      await startScan(selected);
    }
  }

  // ── Derived display values ───────────────────────────────────────────────────

  const scanButtonLabel = isScanning ? "Cancel Scan" : "Scan Folder";
  const scanButtonClass = isScanning
    ? "rounded-full bg-red-600/80 px-5 py-2 text-sm font-semibold text-white shadow-lg hover:brightness-110"
    : "rounded-full bg-[rgb(var(--accent-video))] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 hover:brightness-110";

  const statusItems = [
    `Total: ${formatBytes(progress?.total_size ?? 0)}`,
    `Files: ${formatCount(progress?.scanned ?? 0)}`,
    `Scan: ${isScanning ? "running" : progress?.done ? "done" : "idle"}`,
  ];

  const breadcrumb =
    tree?.path
      .split(/[/\\]/)
      .filter(Boolean)
      .slice(-3) ?? [];

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
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.35em] text-muted">
                Workspace
              </p>
              <div className="mt-2 flex items-center gap-2 overflow-hidden text-sm text-muted">
                {breadcrumb.length > 0 ? (
                  breadcrumb.map((crumb, i) => (
                    <span key={i} className="flex items-center gap-2">
                      {i > 0 && <span>/</span>}
                      <span className="truncate rounded-full bg-white/5 px-3 py-1 text-primary">
                        {crumb}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="truncate rounded-full bg-white/5 px-3 py-1 text-primary">
                    No scan active
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
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
          </header>

          {/* Main canvas area — TreemapCanvas fills this completely */}
          <main
            className="glass-panel relative flex min-h-[420px] flex-1 overflow-hidden rounded-[32px]"
            id="treemap-main"
          >
            {/* Subtle gradient overlay behind the canvas */}
            <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(99,102,241,0.10),transparent_35%),linear-gradient(315deg,rgba(6,182,212,0.09),transparent_28%)]" />

            {/* TreemapCanvas fills the entire pane */}
            <TreemapCanvas />

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
                  <p className="mt-1 max-w-xs truncate font-mono text-[11px] text-muted">
                    {progress.current_path.split(/[/\\]/).at(-1)}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          {/* Status bar */}
          <footer className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-[24px] px-5 py-3">
            <div className="flex flex-wrap gap-2">
              {statusItems.map((item) => (
                <span className="status-chip" key={item}>
                  {item}
                </span>
              ))}
            </div>

            <p className="text-xs uppercase tracking-[0.28em] text-muted">
              {isScanning ? "Scanning…" : "Dusk engine ready"}
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default App;

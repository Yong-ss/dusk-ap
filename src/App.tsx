import { motion } from "framer-motion";
import { useState } from "react";
import { useTheme } from "./components/ThemeProvider";

const sidebarSections = [
  {
    title: "Pinned Volumes",
    items: ["C:\\", "D:\\Media", "/Volumes/Archive"],
  },
  {
    title: "Recent Scans",
    items: ["Users\\sungs\\Downloads", "SteamLibrary", "Projects\\Dusk"],
  },
];

const statusItems = [
  "Total: 0 B",
  "Used: 0 B",
  "Free: 0 B",
  "Files: 0",
  "Scan: idle",
];

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { cycleTheme, resolvedTheme, themeMode } = useTheme();

  return (
    <div className="relative min-h-screen overflow-hidden bg-app text-primary">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(99,102,241,0.18),transparent_26%),radial-gradient(circle_at_80%_0%,rgba(16,185,129,0.12),transparent_22%),linear-gradient(180deg,rgba(15,23,42,0.22),transparent_40%)]" />

      <div className="relative flex min-h-screen p-4">
        <motion.aside
          animate={{ width: sidebarCollapsed ? 88 : 256 }}
          className="glass-panel relative flex shrink-0 flex-col overflow-hidden rounded-[28px]"
          transition={{ duration: 0.25, ease: "easeInOut" }}
        >
          <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
            <div className={sidebarCollapsed ? "hidden" : "block"}>
              <p className="text-xs uppercase tracking-[0.35em] text-muted">Dusk</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">Disk Atlas</h1>
            </div>

            <button
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="rounded-full border border-border-soft bg-white/10 p-2 text-sm text-primary hover:bg-white/15"
              onClick={() => setSidebarCollapsed((value) => !value)}
              type="button"
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
            {sidebarSections.map((section) => (
              <section key={section.title}>
                <p
                  className={`mb-3 text-xs uppercase tracking-[0.3em] text-muted ${
                    sidebarCollapsed ? "sr-only" : ""
                  }`}
                >
                  {section.title}
                </p>

                <div className="space-y-2">
                  {section.items.map((item) => (
                    <button
                      key={item}
                      className="flex w-full items-center gap-3 rounded-2xl border border-transparent bg-white/5 px-3 py-3 text-left text-sm text-primary hover:border-border-soft hover:bg-white/10"
                      type="button"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900/70 text-[11px] font-semibold uppercase text-slate-100">
                        {item.slice(0, 2)}
                      </span>
                      {!sidebarCollapsed ? (
                        <span className="truncate text-sm">{item}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            ))}
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
                <span className="mx-auto">{resolvedTheme === "dark" ? "◐" : "◑"}</span>
              )}
            </button>
          </div>
        </motion.aside>

        <div className="ml-4 flex min-w-0 flex-1 flex-col gap-4">
          <header className="glass-panel flex items-center justify-between rounded-[28px] px-6 py-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.35em] text-muted">Workspace</p>
              <div className="mt-2 flex items-center gap-2 overflow-hidden text-sm text-muted">
                <span className="truncate rounded-full bg-white/5 px-3 py-1 text-primary">
                  Computer
                </span>
                <span>/</span>
                <span className="truncate rounded-full bg-white/5 px-3 py-1 text-primary">
                  Placeholder
                </span>
                <span>/</span>
                <span className="truncate rounded-full bg-white/5 px-3 py-1 text-primary">
                  Treemap Root
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                className="rounded-full border border-border-soft bg-white/5 px-4 py-2 text-sm text-primary hover:bg-white/10"
                type="button"
              >
                Search
              </button>
              <button
                className="rounded-full bg-[rgb(var(--accent-video))] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 hover:brightness-110"
                type="button"
              >
                Scan Folder
              </button>
            </div>
          </header>

          <main className="glass-panel relative flex min-h-[420px] flex-1 overflow-hidden rounded-[32px]">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(99,102,241,0.14),transparent_35%),linear-gradient(315deg,rgba(6,182,212,0.12),transparent_28%)]" />

            <div className="relative flex flex-1 flex-col justify-between px-8 py-7">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="text-xs uppercase tracking-[0.32em] text-muted">
                    Renderer Dock
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                    Treemap canvas mounts here
                  </h2>
                </div>

                <div className="rounded-full border border-border-soft bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.25em] text-muted">
                  Phase 1 shell
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-[24px] border border-border-soft bg-white/5 p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted">Input</p>
                  <p className="mt-3 text-xl font-semibold">No scan active</p>
                  <p className="mt-2 text-sm text-muted">
                    Rust scanner batches and platform abstraction land in Phase 2.
                  </p>
                </div>
                <div className="rounded-[24px] border border-border-soft bg-white/5 p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted">Renderer</p>
                  <p className="mt-3 text-xl font-semibold">Tiered canvas placeholder</p>
                  <p className="mt-2 text-sm text-muted">
                    PixiJS, Canvas 2D, and SVG fallback start in Phase 3.
                  </p>
                </div>
                <div className="rounded-[24px] border border-border-soft bg-white/5 p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted">Status</p>
                  <p className="mt-3 text-xl font-semibold">Ready for first compile</p>
                  <p className="mt-2 text-sm text-muted">
                    Theme, shell layout, and color variables are active now.
                  </p>
                </div>
              </div>
            </div>
          </main>

          <footer className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-[24px] px-5 py-3">
            <div className="flex flex-wrap gap-2">
              {statusItems.map((item) => (
                <span className="status-chip" key={item}>
                  {item}
                </span>
              ))}
            </div>

            <p className="text-xs uppercase tracking-[0.28em] text-muted">
              Dusk shell ready
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default App;

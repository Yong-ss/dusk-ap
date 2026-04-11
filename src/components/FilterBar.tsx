import { useState, useEffect, type Dispatch, type SetStateAction, type RefObject } from "react";
import type { TreeFilters } from "../lib/filter";

// Categories matching colormap extensions mapping
const CATEGORIES: Record<string, string[]> = {
  Video: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v"],
  Image: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tiff", "heic", "raw"],
  Document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "rtf", "pages", "numbers", "key"],
  Archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "dmg", "pkg"],
  Code: ["js", "ts", "jsx", "tsx", "py", "rs", "go", "java", "c", "cpp", "h", "hpp", "cs", "php", "rb", "swift", "kt", "dart", "html", "css", "scss", "json", "xml", "yaml", "yml", "toml", "ini", "sh", "bat", "ps1", "sql"],
};

interface FilterBarProps {
  filters: TreeFilters;
  setFilters: Dispatch<SetStateAction<TreeFilters>>;
  clearFilters: () => void;
  activeCount: number;
  searchInputRef: RefObject<HTMLInputElement | null>;
}

export default function FilterBar({ filters, setFilters, clearFilters, activeCount, searchInputRef }: FilterBarProps) {
  const [localQuery, setLocalQuery] = useState(filters.nameQuery || "");

  // Debounce text input
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(prev => ({ ...prev, nameQuery: localQuery || undefined }));
    }, 300);
    return () => clearTimeout(timer);
  }, [localQuery, setFilters]);

  // Sync if cleared externally
  const [prevQuery, setPrevQuery] = useState(filters.nameQuery);
  if (filters.nameQuery !== prevQuery) {
    setPrevQuery(filters.nameQuery);
    if (!filters.nameQuery) setLocalQuery("");
  }

  const toggleCategory = (cat: string) => {
    const exts = CATEGORIES[cat];
    setFilters(prev => {
      const current = prev.extensions || [];
      // Are all exts of this category currently active?
      const isActive = exts.every(e => current.includes(e));
      let next: string[];
      if (isActive) {
        // Remove them
        next = current.filter(e => !exts.includes(e));
      } else {
        // Add them via Set union
        next = Array.from(new Set([...current, ...exts]));
      }
      return { ...prev, extensions: next.length > 0 ? next : undefined };
    });
  };

  const isCatActive = (cat: string) => {
    const current = filters.extensions || [];
    return CATEGORIES[cat].every(e => current.includes(e));
  };

  return (
    <div className="flex flex-wrap items-center gap-3 px-6 py-2 border-b border-border-soft bg-black/10">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Filter</span>
        {activeCount > 0 && (
          <span className="flex h-5 items-center rounded-full bg-indigo-500/20 px-2 text-[10px] font-bold text-indigo-300">
            {activeCount}
          </span>
        )}
      </div>

      {/* Name Query */}
      <div className="relative flex items-center ml-2">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search files... (Ctrl+F)"
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          className="w-48 lg:w-64 rounded-full border border-border-soft bg-white/5 px-4 py-1.5 text-sm text-primary placeholder:text-muted focus:border-indigo-500/50 focus:bg-white/10 focus:outline-none transition-all"
        />
        {localQuery && (
          <button 
            onClick={() => setLocalQuery("")}
            className="absolute right-3 text-muted hover:text-white"
          >
            ✕
          </button>
        )}
      </div>

      {/* Categories */}
      <div className="flex items-center gap-1.5 ml-2">
        {Object.keys(CATEGORIES).map(cat => (
          <button
            key={cat}
            onClick={() => toggleCategory(cat)}
            className={`rounded-full px-3 py-1 text-xs transition-colors border ${
              isCatActive(cat) 
              ? "bg-[rgb(var(--accent-video))]/20 border-[rgb(var(--accent-video))]/30 text-[rgb(var(--accent-video))]" 
              : "border-transparent bg-white/5 text-muted hover:bg-white/10 hover:text-primary"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* Clear */}
      {activeCount > 0 && (
        <button
          onClick={clearFilters}
          className="rounded-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors mr-2"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

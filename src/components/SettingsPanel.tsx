import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Settings } from "../hooks/useSettings";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

export default function SettingsPanel({ isOpen, onClose, settings, setSettings }: SettingsPanelProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-1/2 z-[70] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border-soft bg-black/80 shadow-2xl backdrop-blur-3xl"
          >
            <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
              <h2 className="text-sm font-semibold tracking-wide text-primary">Settings</h2>
              <button
                aria-label="Close settings"
                className="rounded-full bg-white/10 p-1.5 text-muted hover:bg-white/20 hover:text-primary transition-colors"
                onClick={onClose}
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="space-y-4">
                <h3 className="text-xs uppercase tracking-wider text-muted">Scan Engine</h3>
                
                <label className="flex items-center justify-between">
                  <span className="text-sm text-primary">Show Hidden Files</span>
                  <input 
                    type="checkbox" 
                    checked={settings.showHiddenFiles}
                    onChange={(e) => setSettings(s => ({ ...s, showHiddenFiles: e.target.checked }))}
                    className="h-4 w-4 rounded border-border-soft bg-white/5 text-indigo-500 focus:ring-transparent focus:ring-offset-transparent cursor-pointer"
                  />
                </label>
                
                <label className="flex items-center justify-between">
                  <span className="text-sm text-primary">Include System Files</span>
                  <input 
                    type="checkbox" 
                    checked={settings.includeSystemFiles}
                    onChange={(e) => setSettings(s => ({ ...s, includeSystemFiles: e.target.checked }))}
                    className="h-4 w-4 rounded border-border-soft bg-white/5 text-indigo-500 focus:ring-transparent focus:ring-offset-transparent cursor-pointer"
                  />
                </label>
                <p className="text-[10px] text-muted leading-tight mt-1">Changes to Scan Engine settings will only apply on the next scan.</p>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs uppercase tracking-wider text-muted">Performance & UI</h3>
                
                <div className="space-y-2">
                  <label className="flex items-center justify-between text-sm text-primary">
                    <span>Minimum Block Size</span>
                    <span className="font-mono text-xs bg-white/10 rounded px-1.5 py-0.5">{settings.minBlockSize}px</span>
                  </label>
                  <input 
                    type="range" 
                    min="2" 
                    max="20" 
                    value={settings.minBlockSize}
                    onChange={(e) => setSettings(s => ({ ...s, minBlockSize: parseInt(e.target.value, 10) }))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>
            
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

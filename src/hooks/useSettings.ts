import { useState, useEffect } from "react";

export interface Settings {
  showHiddenFiles: boolean;
  includeSystemFiles: boolean;
  minBlockSize: number;
}

const DEFAULT_SETTINGS: Settings = {
  showHiddenFiles: false,
  includeSystemFiles: false,
  minBlockSize: 2,
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const stored = localStorage.getItem("dusk_settings");
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    localStorage.setItem("dusk_settings", JSON.stringify(settings));
  }, [settings]);

  return { settings, setSettings };
}

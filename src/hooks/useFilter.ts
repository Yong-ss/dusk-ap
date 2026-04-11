import { useState, useCallback } from "react";
import type { TreeFilters } from "../lib/filter";

export interface UseFilterReturn {
  filters: TreeFilters;
  setFilters: React.Dispatch<React.SetStateAction<TreeFilters>>;
  clearFilters: () => void;
  activeCount: number;
}

export function useFilter(): UseFilterReturn {
  const [filters, setFilters] = useState<TreeFilters>({});

  const clearFilters = useCallback(() => {
    setFilters({});
  }, []);

  const activeCount = Object.values(filters).filter((v) => {
    if (v === undefined || v === "") return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  }).length;

  return { filters, setFilters, clearFilters, activeCount };
}

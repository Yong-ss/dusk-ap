import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import FilterBar from "./FilterBar";
import { type TreeFilters } from "../lib/filter";

describe("FilterBar component", () => {
  const mockSetFilters = vi.fn();
  const mockClearFilters = vi.fn();
  const mockRef = { current: null } as any;

  const defaultFilters: TreeFilters = {
    nameQuery: "",
  };

  it("renders with active count", () => {
    render(
      <FilterBar 
        filters={defaultFilters} 
        setFilters={mockSetFilters} 
        clearFilters={mockClearFilters} 
        activeCount={3} 
        searchInputRef={mockRef}
      />
    );
    
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByPlaceholderText(/Search files/)).toBeDefined();
  });

  it("triggers category toggle", () => {
    render(
      <FilterBar 
        filters={defaultFilters} 
        setFilters={mockSetFilters} 
        clearFilters={mockClearFilters} 
        activeCount={0} 
        searchInputRef={mockRef}
      />
    );
    
    const videoBtn = screen.getByText("Video");
    fireEvent.click(videoBtn);
    
    expect(mockSetFilters).toHaveBeenCalled();
  });

  it("calls clearFilters on button click", () => {
    render(
      <FilterBar 
        filters={defaultFilters} 
        setFilters={mockSetFilters} 
        clearFilters={mockClearFilters} 
        activeCount={5} 
        searchInputRef={mockRef}
      />
    );
    
    const clearBtn = screen.getByText("Clear filters");
    fireEvent.click(clearBtn);
    
    expect(mockClearFilters).toHaveBeenCalled();
  });
});

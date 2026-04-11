import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Tooltip from "./Tooltip";
import { type TreemapRect } from "../types";

describe("Tooltip component", () => {
  const mockRect: TreemapRect = {
    id: "test",
    name: "test-file.txt",
    path: "/test/test-file.txt",
    size: 1048576, // 1MB
    kind: "file",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    depth: 0,
    color: 0xffffff,
    label: "test-file.txt",
    extension: "txt"
  };

  it("renders NOTHING when rect is null", () => {
    const { container } = render(<Tooltip rect={null} position={{ x: 0, y: 0 }} totalSize={1000000} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders with correct file information", () => {
    render(<Tooltip rect={mockRect} position={{ x: 50, y: 50 }} totalSize={1048576 * 10} />);
    
    expect(screen.getByText("test-file.txt")).toBeDefined();
    expect(screen.getByText("1.00 MB")).toBeDefined();
    // Use regex to be more flexible with potential whitespace/newlines in the test environment
    expect(screen.getByText(/10\.00/)).toBeDefined();
  });

  it("positions itself correctly (with 20px offset)", () => {
    const { container } = render(<Tooltip rect={mockRect} position={{ x: 200, y: 300 }} totalSize={1000000} />);
    const tooltipDiv = container.querySelector('div');
    // It uses left: pos.x + 20, top: pos.y + 20
    expect(tooltipDiv?.style.left).toBe("220px");
    expect(tooltipDiv?.style.top).toBe("320px");
  });
});

import { describe, it, expect } from "vitest";
import { DEFAULT_COLOR_MAP } from "./colormap";

describe("colormap.ts", () => {
  it("C1. Extension categories", () => {
    // Media
    expect(DEFAULT_COLOR_MAP["mp4"]).toBeDefined();
    expect(DEFAULT_COLOR_MAP["jpg"]).toBeDefined();
    expect(DEFAULT_COLOR_MAP["png"]).toBeDefined();
    
    // Code
    expect(DEFAULT_COLOR_MAP["ts"]).toBeDefined();
    expect(DEFAULT_COLOR_MAP["rs"]).toBeDefined();
    
    // System
    expect(DEFAULT_COLOR_MAP["dll"]).toBeDefined();
    expect(DEFAULT_COLOR_MAP["sys"]).toBeDefined();
  });

  it("C2. Case sensitivity", () => {
    // The mapper should look up extensions case-insensitively or the preprocessing should handle it.
    // In computeTreemap, extension is taken from node.extension.
    // Let's verify what the map contains.
    expect(DEFAULT_COLOR_MAP["MP4"]).toBeUndefined(); // Map itself is lowercase
  });

  it("C3. Unknown extensions", () => {
    expect(DEFAULT_COLOR_MAP["xyz_unknown"]).toBeUndefined();
  });
});

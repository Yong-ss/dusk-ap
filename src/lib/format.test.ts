import { describe, it, expect } from "vitest";
import { formatBytes, formatCount, truncatePath } from "./format";

describe("format.ts helpers", () => {
  describe("formatBytes", () => {
    it("FR1. Size formatting", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(1023)).toBe("1023 B");
      expect(formatBytes(1024)).toBe("1.00 KB");
      expect(formatBytes(1048576)).toBe("1.00 MB");
      expect(formatBytes(1073741824)).toBe("1.00 GB");
      expect(formatBytes(1099511627776)).toBe("1.00 TB");
      expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GB");
    });
  });

  describe("formatCount", () => {
    it("formats large numbers with commas", () => {
      expect(formatCount(0)).toBe("0");
      expect(formatCount(1000)).toBe("1,000");
      expect(formatCount(1234567)).toBe("1,234,567");
    });
  });

  describe("truncatePath", () => {
    it("FR3. Path truncation", () => {
      const short = "C:/Users/Short/Path";
      expect(truncatePath(short, 40)).toBe(short);

      const long = "C:/Users/Someone/With/A/Very/Long/Directory/Path/Into/Something/Deep/file.txt";
      const truncated = truncatePath(long, 40);
      expect(truncated.length).toBeLessThanOrEqual(40);
      expect(truncated).toContain("...");
      expect(truncated.startsWith("C:/")).toBe(true);
      expect(truncated.endsWith("file.txt")).toBe(true);
    });
  });
});

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useScan } from "./useScan";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("useScan integration hook", () => {
  const mockSettings = {
    showHiddenFiles: false,
    includeSystemFiles: false,
    minBlockSize: 2,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers listeners and invokes scan on startScan", async () => {
    const unlisten = vi.fn();
    (listen as any).mockResolvedValue(unlisten);

    const { result } = renderHook(() => useScan());

    await act(async () => {
      await result.current.startScan("C:/test", mockSettings);
    });

    expect(listen).toHaveBeenCalledWith("scan_chunk", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("scan_error", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("scan_start", expect.any(Function));
    expect(invoke).toHaveBeenCalledWith("scan_directory", expect.objectContaining({ path: "C:/test" }));
    expect(result.current.isScanning).toBe(true);
  });

  it("manages progress and builds tree on finish", async () => {
    let chunkCallback: any;
    (listen as any).mockImplementation((event: string, cb: any) => {
      if (event === "scan_chunk") chunkCallback = cb;
      return Promise.resolve(() => {});
    });

    const { result } = renderHook(() => useScan());

    await act(async () => {
      await result.current.startScan("C:/test", mockSettings);
    });

    // Send a chunk
    await act(async () => {
      chunkCallback({
        payload: {
          nodes: [
            { id: "1", name: "test", path: "C:/test", size: 1000, kind: "dir" },
            { id: "2", name: "file.txt", path: "C:/test/file.txt", size: 1000, kind: "file" },
          ],
          progress: { scanned: 2, total_size: 1000, current_path: "C:/test", done: true }
        }
      });
    });

    expect(result.current.isScanning).toBe(false);
    expect(result.current.tree).not.toBeNull();
    expect(result.current.tree?.children).toHaveLength(1);
    expect(result.current.progress?.done).toBe(true);
  });

  it("handles errors and marks scanning as false", async () => {
    let errorCallback: any;
    (listen as any).mockImplementation((event: string, cb: any) => {
      if (event === "scan_error") errorCallback = cb;
      return Promise.resolve(() => {});
    });

    const { result } = renderHook(() => useScan());

    await act(async () => {
      await result.current.startScan("C:/test", mockSettings);
    });

    await act(async () => {
      errorCallback({ payload: "Access Denied" });
    });

    expect(result.current.isScanning).toBe(false);
    expect(result.current.error).toBe("Access Denied");
  });
});

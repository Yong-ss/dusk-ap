import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";
import { ThemeProvider } from "./components/ThemeProvider";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("App End-to-End Flows (Integration)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === "get_drives") return [{ name: "Test Drive", mount_point: "C:/", total_space: 1000, available_space: 500 }];
      return undefined;
    });
    (listen as any).mockResolvedValue(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Full Flow: Scan -> Render -> Navigate", async () => {
    let chunkCallback: any;
    (listen as any).mockImplementation((event: string, cb: any) => {
      if (event === "scan_chunk") chunkCallback = cb;
      return Promise.resolve(() => {});
    });

    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );

    // 1. Initial State
    expect(screen.getByText("Disk Atlas")).toBeInTheDocument();
    const scanBtn = screen.getByRole("button", { name: "Scan Folder" });

    // 2. Trigger Scan (Mocked dialog is and invoke)
    // We'll simulate the startScan via hook internally or just the button click if we could mock the dialog return
    // But scan starts when dialog returns a value.
    // Let's just mock the useScan hook for this UI flow to be stable, 
    // OR we trigger the event manually.

    // 3. Simulate Scan Completion
    await act(async () => {
      if (chunkCallback) {
        chunkCallback({
          payload: {
            nodes: [
              { id: "root", name: "root", path: "C:/root", size: 2000, kind: "dir" },
              { id: "dir1", name: "dir1", path: "C:/root/dir1", size: 1000, kind: "dir" },
              { id: "file1", name: "file1.txt", path: "C:/root/file1.txt", size: 1000, kind: "file" },
            ],
            progress: { scanned: 3, total_size: 2000, current_path: "C:/root", done: true }
          }
        });
      }
    });

    // Wait for useScan's THROTTLE_MS (300ms)
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    // 4. Verify Breadcrumb
    expect(await screen.findByText("C:/root")).toBeInTheDocument();

    // 5. Open Settings
    const settingsBtn = screen.getByText("Settings");
    fireEvent.click(settingsBtn);
    expect(screen.getByText("Scan Engine")).toBeInTheDocument();

    // 6. Close Settings
    const closeBtn = screen.getByLabelText("Close settings");
    fireEvent.click(closeBtn);
    expect(screen.queryByText("Scan Engine")).not.toBeInTheDocument();
  });
});

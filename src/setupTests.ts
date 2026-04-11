import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// ── matchMedia (jsdom doesn't implement it) ───────────────────────────────────
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: query.includes("dark"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

// ── ResizeObserver (not in jsdom) ─────────────────────────────────────────────
(globalThis as Record<string, unknown>)["ResizeObserver"] = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ── HTMLCanvasElement.getContext (not in jsdom) ───────────────────────────────
// Return null so createRenderer() gracefully falls through to SVG tier.
HTMLCanvasElement.prototype.getContext = () => null;

// ── Tauri Mocks ───────────────────────────────────────────────────────────────
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

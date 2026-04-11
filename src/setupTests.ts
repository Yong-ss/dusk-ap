import "@testing-library/jest-dom/vitest";

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
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ── HTMLCanvasElement.getContext (not in jsdom) ───────────────────────────────
// Return null so createRenderer() gracefully falls through to SVG tier.
HTMLCanvasElement.prototype.getContext = () => null;

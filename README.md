# 🌌 Dusk 

**Blazing Fast. Beautifully Visual. Deeply Insightful.**

Dusk is a high-performance disk space visualizer built for the modern era. Leveraging **Tauri v2**, **Rust**, and **React 19**, it provides a desktop-native experience that makes billions of bytes instantly understandable through interactive treemaps.

## ⚡ Key Features

- **MFT Fast Scan**: Harnesses the Windows Master File Table for near-instant indexing of millions of files (Requires Admin).
- **Hybrid Rendering Engine**: Automatically selects the best rendering tier for your hardware (WebGL via PixiJS → Canvas2D → SVG).
- **Zero-Jank UI**: Adaptive throttling ensures the app remains 100% interactive even during massive disk scans.
- **Deep Drill-down**: Navigate through your filesystem breadcrumbs with smooth animations and instant filtering.

## 🚀 Status: Phase 2 Finalized & Verified

The project has achieved core stability:
- [x] **Verified MFT Engine**: High-speed indexing with sector-aligned raw disk access.
- [x] **Throttled Visualization**: Stable UI performance on drives with 1M+ files.
- [x] **Full Integration Testing**: 100% test pass rate for scanning and rendering flows.
- [x] **Clean Production Build**: Zero TypeScript or compilation errors.

## 🛠 Tech Stack

| Core | UI/UX | Backend |
| :--- | :--- | :--- |
| **Tauri v2** (Shell) | **React 19** + **TS** | **Rust** (Engine) |
| **Vite** (Bundler) | **Tailwind CSS** | **ntfs** (MFT Parsing) |
| **PixiJS** (Renderer) | **Framer Motion** | **tokio** (Async) |

## 📦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+)
- [Rust Toolchain](https://www.rust-lang.org/tools/install)
- [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Installation
```bash
npm install
```

### Development
```bash
# Run the Desktop App
npm run tauri dev

# Run FULL Testing Suite
npm run test:run
```

## 🏗 Project Structure

```text
dusk/
├── src/                # Modern React UI
│   ├── renderer/       # Hardware-aware drawing logic
│   ├── hooks/          # Scanning & State orchestration
│   └── components/     # Atomic UI units
├── src-tauri/          # High-performance Rust backend
│   └── src/platform/   # OS-specific scanning logic (MFT/Unix)
└── manual_testing/     # Interactive QA checklists
```

## 🗺 Roadmap

1. [x] Core Shell & UI Foundation
2. [x] Hardware-Tiered Renderer (WebGL/Canvas/SVG)
3. [x] Windows MFT Fast-Scan Implementation
4. [x] **Optimization Phase**: Zero-Jank scan strategy implemented.
5. [ ] Global File Search & Metadata Indexing
6. [ ] Context Menu File Actions (Delete, Reveal in Explorer)
7. [ ] Production-grade Packaging & Release

---
*Built with ❤️ for those who hate missing disk space.*

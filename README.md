# Dusk

A cross-platform disk space visualizer built with Tauri v2, React, TypeScript, and Rust.

Dusk is designed to feel like a modern desktop-native answer to tools such as WizTree and SpaceSniffer: fast startup, progressive rendering, renderer fallback by hardware tier, and a UI that stays smooth even when the filesystem does not.

## Status

Current milestone: `Phase 1` complete.

Implemented right now:
- Tauri v2 + React + TypeScript + Vite project scaffold
- Tailwind CSS setup with class-based dark mode
- Desktop shell layout for the Dusk app
- Collapsible left sidebar
- Top toolbar with placeholder breadcrumb and scan action
- Main visualization surface placeholder
- Bottom status bar placeholder
- Theme provider with system preference detection and manual toggle
- Basic smoke test with Vitest

Not implemented yet:
- Real filesystem scanning
- Platform abstraction layer
- Treemap layout algorithm
- PixiJS / Canvas / SVG renderer tiers
- Search, filtering, drill-down, tooltip, and context menu

## Tech Stack

- Frontend: React 19 + TypeScript + Vite
- Desktop shell: Tauri v2
- Styling: Tailwind CSS
- Motion: Framer Motion
- Rendering foundation: PixiJS
- Backend engine: Rust
- Testing: Vitest + Testing Library

## Why Dusk

- Cross-platform target: Windows, macOS, Linux
- Native desktop packaging through Tauri
- Rust-based filesystem engine for speed and control
- Renderer downgrade path for weaker hardware
- Architecture designed for streaming, incremental updates instead of blocking full scans
- Graceful fallback behavior instead of crashing on permission issues

## Development

### Prerequisites

Make sure these are installed:
- Node.js 20+
- Rust toolchain
- Tauri v2 prerequisites for your OS

Windows users should also have the normal Tauri desktop prerequisites available.

### Install

```bash
npm install
```

### Run the frontend only

```bash
npm run dev
```

Frontend dev server:
- `http://localhost:1420`

### Run the desktop app

```bash
npm run tauri dev
```

### Build

```bash
npm run build
```

### Test

```bash
npm run test:run
```

## Project Structure

```text
Dusk/
├── src/                 # React UI shell
├── src-tauri/           # Rust + Tauri backend
├── public/              # Static assets
├── package.json
├── tailwind.config.ts
├── vite.config.ts
└── README.md
```

## GitHub Notes

Recommended to commit:
- `src/`
- `src-tauri/src/`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `public/`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `README.md`

Recommended to keep out of Git:
- `node_modules/`
- `dist/`
- `src-tauri/target/`
- `src-tauri/gen/`
- local `.env` files
- temporary workspace folders

## Roadmap

Planned phases after the current shell:
1. Rust scanning engine with platform abstraction
2. Tiered renderer detection and fallback
3. Squarified treemap layout
4. Real scan data rendering and interaction
5. Search and filter system
6. UI polish, animation, and settings
7. Windows MFT fast-path optimization
8. Packaging and release automation

## Vision

Dusk is not trying to be just another file tree viewer.
It aims to be a hardware-aware disk map that opens fast, renders progressively, and makes huge directories feel instantly understandable.

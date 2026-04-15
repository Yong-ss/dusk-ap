# 🌌 Dusk 

**Blazing Fast. Beautifully Visual. Deeply Insightful.**

Dusk is a high-performance disk space visualizer built for the modern era. Leveraging **Tauri v2**, **Rust**, and **React 19**, it provides a desktop-native experience that makes billions of bytes instantly understandable through interactive treemaps.

---

## Key Features

- **MFT Fast Scan**: Harnesses the Windows Master File Table for near-instant indexing of millions of files. (Requires Administrator privileges).
- **Hybrid Rendering Engine**: Hardware-aware rendering that scales with your GPU (WebGL via PixiJS → Canvas2D → SVG).
- **Zero-Jank UI**: Adaptive throttling and asynchronous scanning ensure the app remains 100% interactive even during massive 1TB+ disk scans.
- **Deep Drill-down**: Navigate through your filesystem breadcrumbs with fluid animations and instant search-as-you-type filtering.

## 🛠 Tech Stack

| Component | Technology | Role |
| :--- | :--- | :--- |
| **Shell** | [Tauri v2](https://v2.tauri.app/) | Cross-platform runtime & bridge |
| **Logic** | [React 19](https://react.dev/) + TypeScript | UI State Management |
| **Engine** | [Rust](https://www.rust-lang.org/) | High-performance MFT parsing |
| **Graphics** | [PixiJS](https://pixijs.com/) | High-speed treemap rendering |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) | Modern, responsive design |

## Getting Started

### Prerequisites
- **Node.js**: v20 or higher
- **Rust Toolchain**: Stable (latest)
- **Permissions**: Windows Administrator (for MFT raw disk access)

### Installation
```bash
# Clone the repository
git clone https://github.com/yourusername/dusk.git
cd dusk

# Install dependencies
npm install
```

### Development
```bash
# Run the application in development mode
npm run tauri dev

# Run unit and integration tests
npm run test:run
```

## 🏗 Project Architecture

- `src/`: React frontend with hardware-tiered rendering logic.
- `src-tauri/src/platform/`: Optimized scanning algorithms including Windows MFT and Universal Walkdir.
- `src-tauri/src/commands.rs`: Bridge between the high-speed Rust engine and the UI.

---

*Built for those who hate missing disk space. Part of the Dusk Ecosystem.*

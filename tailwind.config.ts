import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "rgb(var(--bg-app) / <alpha-value>)",
        surface: "rgb(var(--bg-surface) / <alpha-value>)",
        panel: "rgb(var(--bg-panel) / <alpha-value>)",
        glass: "rgb(var(--bg-glass))",
        primary: "rgb(var(--text-primary) / <alpha-value>)",
        muted: "rgb(var(--text-muted) / <alpha-value>)",
        "border-soft": "rgb(var(--border-soft))",
        video: "rgb(var(--accent-video) / <alpha-value>)",
        image: "rgb(var(--accent-image) / <alpha-value>)",
        document: "rgb(var(--accent-document) / <alpha-value>)",
        archive: "rgb(var(--accent-archive) / <alpha-value>)",
        code: "rgb(var(--accent-code) / <alpha-value>)",
        system: "rgb(var(--accent-system) / <alpha-value>)",
        other: "rgb(var(--accent-other) / <alpha-value>)"
      },
      boxShadow: {
        glow: "var(--shadow-glow)"
      }
    }
  },
  plugins: []
};

export default config;

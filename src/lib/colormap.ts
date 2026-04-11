/**
 * Color map for file-type classification.
 *
 * Matches the palette defined in the master architecture document:
 *   Video     → indigo  #6366f1
 *   Image     → emerald #10b981
 *   Document  → amber   #f59e0b
 *   Archive   → red     #ef4444
 *   Code      → cyan    #06b6d4
 *   System    → slate   #6b7280
 *   Other     → purple  #8b5cf6  ('' key = fallback)
 */

/** Maps lowercase file extension (no leading dot) → 0xRRGGBB color. */
export type ColorMap = Record<string, number>;

export const DEFAULT_COLOR_MAP: ColorMap = {
  // ── Video ──────────────────────────────────────────────────────────────────
  mp4: 0x6366f1,
  mkv: 0x6366f1,
  avi: 0x6366f1,
  mov: 0x6366f1,
  wmv: 0x6366f1,
  flv: 0x6366f1,
  webm: 0x6366f1,
  m4v: 0x6366f1,

  // ── Image ──────────────────────────────────────────────────────────────────
  jpg: 0x10b981,
  jpeg: 0x10b981,
  png: 0x10b981,
  gif: 0x10b981,
  bmp: 0x10b981,
  webp: 0x10b981,
  tiff: 0x10b981,
  raw: 0x10b981,
  nef: 0x10b981,
  arw: 0x10b981,
  heic: 0x10b981,
  svg: 0x10b981,

  // ── Document ───────────────────────────────────────────────────────────────
  pdf: 0xf59e0b,
  doc: 0xf59e0b,
  docx: 0xf59e0b,
  xls: 0xf59e0b,
  xlsx: 0xf59e0b,
  ppt: 0xf59e0b,
  pptx: 0xf59e0b,
  odt: 0xf59e0b,
  txt: 0xf59e0b,
  md: 0xf59e0b,

  // ── Archive ────────────────────────────────────────────────────────────────
  zip: 0xef4444,
  rar: 0xef4444,
  "7z": 0xef4444,
  tar: 0xef4444,
  gz: 0xef4444,
  bz2: 0xef4444,
  xz: 0xef4444,
  zst: 0xef4444,
  iso: 0xef4444,

  // ── Code ───────────────────────────────────────────────────────────────────
  js: 0x06b6d4,
  ts: 0x06b6d4,
  jsx: 0x06b6d4,
  tsx: 0x06b6d4,
  py: 0x06b6d4,
  rs: 0x06b6d4,
  go: 0x06b6d4,
  java: 0x06b6d4,
  cpp: 0x06b6d4,
  c: 0x06b6d4,
  h: 0x06b6d4,
  cs: 0x06b6d4,
  rb: 0x06b6d4,
  php: 0x06b6d4,
  swift: 0x06b6d4,
  kt: 0x06b6d4,
  json: 0x06b6d4,
  yaml: 0x06b6d4,
  yml: 0x06b6d4,
  toml: 0x06b6d4,
  xml: 0x06b6d4,
  html: 0x06b6d4,
  css: 0x06b6d4,
  scss: 0x06b6d4,
  sh: 0x06b6d4,
  bat: 0x06b6d4,
  ps1: 0x06b6d4,

  // ── System ─────────────────────────────────────────────────────────────────
  dll: 0x6b7280,
  sys: 0x6b7280,
  exe: 0x6b7280,
  msi: 0x6b7280,
  so: 0x6b7280,
  dylib: 0x6b7280,
  bin: 0x6b7280,
  dat: 0x6b7280,
  db: 0x6b7280,
  log: 0x6b7280,
  tmp: 0x6b7280,
  bak: 0x6b7280,

  // ── Fallback (no extension or unknown) ─────────────────────────────────────
  "": 0x8b5cf6,
};

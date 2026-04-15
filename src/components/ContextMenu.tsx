import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { formatBytes } from '../lib/format';

export interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  name: string;
  size?: number;
  isVirtual?: boolean;
}

interface ContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  onDeleted?: () => void;
}

export default function ContextMenu({ menu, onClose, onDeleted }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  // Clamp menu position to viewport so it never overflows
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > vw - 4) x = vw - rect.width - 4;
    if (y + rect.height > vh - 4) y = vh - rect.height - 4;
    if (x < 4) x = 4;
    if (y < 4) y = 4;
    setPos({ x, y });
  }, [menu.x, menu.y, deleteArmed]); // re-clamp when armed (menu grows)

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteArmed) setDeleteArmed(false);
        else onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose, deleteArmed]);

  const handleReveal = async () => {
    onClose();
    try { await revealItemInDir(menu.path); }
    catch (e) { console.error('[ContextMenu] reveal error:', e); }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(menu.path);
      setCopied(true);
      setTimeout(() => onClose(), 600);
    } catch (e) {
      console.error('[ContextMenu] copy error:', e);
    }
  };

  const handleDeleteClick = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    onClose();
    try {
      await invoke('delete_path', { path: menu.path });
      onDeleted?.();
    } catch (e) {
      console.error('[ContextMenu] delete error:', e);
      window.alert(`Failed to delete:\n${e}`);
    }
  };

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[200px] py-1.5 bg-gray-900/95 backdrop-blur-xl border border-gray-700/60 rounded-lg shadow-2xl text-sm select-none animate-ctx-in"
      style={{ left: pos.x, top: pos.y }}
    >
      <button onClick={handleReveal} className="w-full flex items-center gap-3 px-4 py-2 text-left text-gray-200 hover:bg-gray-700/50 transition-colors">
        <span className="text-sm w-5 text-center">📂</span>
        <span>Open in Explorer</span>
      </button>

      <button onClick={handleCopy} className="w-full flex items-center gap-3 px-4 py-2 text-left text-gray-200 hover:bg-gray-700/50 transition-colors">
        <span className="text-sm w-5 text-center">{copied ? '✅' : '📋'}</span>
        <span>{copied ? 'Copied!' : 'Copy Path'}</span>
      </button>

      {!menu.isVirtual && <>
      <div className="my-1 mx-2 border-t border-gray-700/50" />

      <button
        onClick={handleDeleteClick}
        className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-all ${
          deleteArmed
            ? 'bg-red-600 text-white font-semibold'
            : 'text-red-400 hover:bg-red-900/30'
        }`}
      >
        <span className="text-sm w-5 text-center">🗑️</span>
        <span>{deleteArmed ? 'Click again to confirm' : 'Delete'}</span>
      </button>

      {deleteArmed && (
        <div className="px-4 py-1.5 text-[10px] text-red-300/70 space-y-0.5">
          <div className="truncate">{menu.path}</div>
          {menu.size != null && menu.size > 0 && (
            <div className="text-red-400 font-mono font-semibold">{formatBytes(menu.size)}</div>
          )}
        </div>
      )}
      </>}
    </div>
  );
}

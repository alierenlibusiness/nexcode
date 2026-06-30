"use client";

import { useEffect, useRef, useState } from "react";
import type { FileContentDTO } from "../../global";

export function CodeEditor({
  file,
  path,
  onSaved,
}: {
  file: FileContentDTO | null;
  path: string | null;
  onSaved?: (path: string) => void;
}) {
  const [value, setValue] = useState("");
  const [original, setOriginal] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (file && !file.tooLarge) {
      setValue(file.content);
      setOriginal(file.content);
    } else {
      setValue("");
      setOriginal("");
    }
  }, [file]);

  const dirty = value !== original;

  async function save() {
    if (!path || !window.nexcode || !dirty) return;
    setSaving(true);
    try {
      await window.nexcode.writeFile(path, value);
      setOriginal(value);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
      onSaved?.(path);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + "  " + value.slice(end);
      setValue(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }

  if (!path) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center p-4 bg-ink-950/10">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 mb-3 animate-pulse">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p className="text-xs text-neutral-400">Soldan bir dosya seçerek düzenlemeye başlayabilirsiniz.</p>
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-neutral-500 bg-ink-900/50 border border-ink-800 rounded-lg px-2.5 py-1">
          <span>Kaydetmek için:</span>
          <kbd className="rounded bg-ink-950 border border-ink-700 px-1.5 py-0.5 font-sans font-bold">Ctrl+S</kbd>
        </div>
      </div>
    );
  }

  if (file?.tooLarge) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center bg-ink-950/10 text-xs text-amber-500/80">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>Dosya görüntülemek için çok büyük (&gt;2 MB).</span>
      </div>
    );
  }

  const lineCount = value.split("\n").length;
  const fileName = path.split(/[\\/]/).pop();

  return (
    <div className="flex h-full flex-col bg-ink-950/10">
      {/* Tab bar header */}
      <div className="flex h-10 items-center justify-between border-b border-ink-700 bg-ink-900/60 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-bold text-neutral-200 select-none">{fileName}</span>
          {dirty && (
            <span title="Kaydedilmemiş değişiklikler var" className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulse" />
          )}
          <span className="truncate text-[10px] text-neutral-500 font-mono select-none" title={path}>{path}</span>
        </div>
        <button
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-1 text-[10px] font-bold text-neutral-300 transition-all hover:border-brand-500/40 hover:text-white disabled:opacity-40 hover:shadow-glow-sm"
        >
          {savedFlash ? "Kaydedildi ✓" : saving ? "Kaydediliyor..." : "Kaydet (Ctrl+S)"}
        </button>
      </div>

      {/* Editor Body */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden font-mono text-[11px] leading-[1.6]">
        <div
          ref={gutterRef}
          className="select-none overflow-hidden border-r border-ink-800 bg-ink-950/40 py-2.5 text-right text-neutral-600 font-mono"
          style={{ minWidth: "3.2rem" }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="px-2.5">
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={taRef}
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          className="flex-1 resize-none bg-transparent px-3 py-2.5 text-neutral-200 outline-none overflow-y-auto selection:bg-brand-500/30"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, Consolas, monospace" }}
        />
      </div>
    </div>
  );
}

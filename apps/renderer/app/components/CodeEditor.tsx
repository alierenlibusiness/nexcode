"use client";

import { useEffect, useRef, useState } from "react";
import type { FileContentDTO } from "../../global";

/**
 * Düzenlenebilir kod editörü: satır numarası cetveli + Tab desteği + dirty göstergesi +
 * Ctrl/Cmd+S ile kaydetme (fsWriteFile IPC). Kullanıcının kendi dosyasını düzenlemesi.
 */
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
      <div className="flex h-full items-center justify-center text-sm text-neutral-600">
        Soldan bir dosya seç — burada düzenleyebilirsin. Kaydetmek için <kbd className="mx-1 rounded bg-ink-800 px-1.5 py-0.5 text-[10px]">Ctrl+S</kbd>.
      </div>
    );
  }
  if (file?.tooLarge) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-amber-500/80">
        Dosya görüntülemek için çok büyük (&gt;2 MB).
      </div>
    );
  }

  const lineCount = value.split("\n").length;
  const fileName = path.split(/[\\/]/).pop();

  return (
    <div className="flex h-full flex-col">
      {/* Sekme/başlık şeridi */}
      <div className="flex items-center justify-between border-b border-ink-700 bg-ink-900/60 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs text-neutral-300">{fileName}</span>
          {dirty && <span title="kaydedilmemiş" className="h-1.5 w-1.5 rounded-full bg-brand-400" />}
          <span className="truncate text-[10px] text-neutral-600">{path}</span>
        </div>
        <button
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded-md border border-ink-700 bg-ink-800/60 px-2 py-0.5 text-[10px] text-neutral-300 transition hover:border-brand-500/50 hover:text-white disabled:opacity-40"
        >
          {savedFlash ? "Kaydedildi ✓" : saving ? "Kaydediliyor…" : "Kaydet (Ctrl+S)"}
        </button>
      </div>

      {/* Editör gövdesi: gutter + textarea */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden font-mono text-xs leading-[1.5]">
        <div
          ref={gutterRef}
          className="select-none overflow-hidden border-r border-ink-800 bg-ink-950/60 py-2 text-right text-neutral-600"
          style={{ minWidth: "3rem" }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="px-2">
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
          className="flex-1 resize-none bg-transparent px-3 py-2 text-neutral-100 outline-none"
        />
      </div>
    </div>
  );
}

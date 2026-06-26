"use client";

import { useEffect, useRef, useState } from "react";

const TERMINAL_ID = "main";

/**
 * Hafif terminal/komut konsolu (PRD §5.2). main bir kalıcı-cwd shell oturumu yürütür;
 * burada çıktıyı stream eder, komut satırını göndeririz. ANSI temizleme minimaldir
 * (clear dışında); vibe-coding için "komut çalıştır + çıktı gör" yeterli.
 */
export function TerminalPanel() {
  const [lines, setLines] = useState<string>("");
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const api = window.nexcode;
    if (!api) return;
    const off = api.onTerminalData(({ id, data }) => {
      if (id !== TERMINAL_ID) return;
      setLines((prev) => {
        // Basit \x1b[2J (clear) desteği
        if (data.includes("\x1b[2J")) return "";
        return prev + data;
      });
    });
    void api.terminalStart(TERMINAL_ID);
    return () => {
      off();
      void api.terminalKill(TERMINAL_ID);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  function submit() {
    const api = window.nexcode;
    if (!api) return;
    void api.terminalInput(TERMINAL_ID, input);
    setInput("");
  }

  // ANSI prompt sequence'lerini görüntü için sadeleştir (\r → satır başı).
  // eslint-disable-next-line no-control-regex
  const display = lines.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");

  return (
    <div className="flex h-full flex-col bg-black/40" onClick={() => inputRef.current?.focus()}>
      <div className="border-b border-neutral-800 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        Terminal
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-1 font-mono text-[11px] leading-relaxed text-neutral-300">
        <pre className="whitespace-pre-wrap break-words">{display}</pre>
      </div>
      <div className="flex items-center gap-1 border-t border-neutral-800 px-2 py-1">
        <span className="text-[11px] text-emerald-400">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="komut yaz, Enter ile çalıştır (örn. git status)"
          className="flex-1 bg-transparent font-mono text-[11px] text-neutral-100 outline-none placeholder:text-neutral-700"
        />
      </div>
    </div>
  );
}

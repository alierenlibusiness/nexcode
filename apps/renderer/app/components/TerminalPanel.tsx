"use client";

import { useEffect, useRef, useState } from "react";

const TERMINAL_ID = "main";

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

  // Clear console log manually
  function clearConsole() {
    setLines("");
  }

  // Remove ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  const display = lines.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");

  return (
    <div className="flex h-full flex-col bg-ink-950/70 border-t border-ink-800" onClick={() => inputRef.current?.focus()}>
      <div className="flex h-9 items-center justify-between bg-ink-900/60 px-3 border-b border-ink-800/60">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500 select-none">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-400">
            <polyline points="4 17 10 11 4 5"/>
            <line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
          <span>Terminal Konsolu</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            clearConsole();
          }}
          title="Konsolu Temizle"
          className="rounded p-1 hover:bg-ink-800 text-neutral-500 hover:text-neutral-300 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18"/>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
          </svg>
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[10px] leading-relaxed text-neutral-300 select-text">
        <pre className="whitespace-pre-wrap break-words" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
          {display || "nexcode terminal hazır.\n"}
        </pre>
      </div>

      <div className="flex items-center gap-1.5 border-t border-ink-800/40 bg-ink-950 px-3 py-1.5">
        <span className="text-[10px] font-bold font-mono text-brand-400 select-none">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Komut çalıştırın (örn. git status, npm install)..."
          className="flex-1 bg-transparent font-mono text-[11px] text-neutral-100 outline-none placeholder:text-neutral-700"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        />
      </div>
    </div>
  );
}

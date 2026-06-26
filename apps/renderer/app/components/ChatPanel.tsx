"use client";

import { useState, useRef } from "react";
import type { Task } from "@nexcode/core";
import type { ApprovalDTO } from "../../global";

export interface ChatEntry {
  kind: "user" | "system" | "agent";
  text: string;
  images?: Array<{ mimeType: string; data: string }>;
}

export function ChatPanel({
  chat,
  request,
  busy,
  available,
  approvals,
  backlog,
  onRequestChange,
  onPlan,
  onDispatch,
  onResolve,
  setChat,
}: {
  chat: ChatEntry[];
  request: string;
  busy: boolean;
  available: boolean;
  approvals: ApprovalDTO[];
  backlog: Task[];
  onRequestChange: (v: string) => void;
  onPlan: (text: string, images?: Array<{ mimeType: string; data: string }>) => void;
  onDispatch: (taskId: string) => void;
  onResolve: (id: string, decision: "approved" | "rejected") => void;
  setChat: React.Dispatch<React.SetStateAction<ChatEntry[]>>;
}) {
  const [attachedImages, setAttachedImages] = useState<Array<{ name: string; mimeType: string; data: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    processFiles(files);
  };

  const processFiles = (files: FileList) => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file || !file.type.startsWith("image/")) continue;

      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        const commaIndex = result.indexOf(",");
        const base64Data = result.slice(commaIndex + 1);
        setAttachedImages((prev) => [
          ...prev,
          {
            name: file.name,
            mimeType: file.type,
            data: base64Data,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      processFiles(e.clipboardData.files);
    }
  };

  const removeAttachedImage = (index: number) => {
    setAttachedImages((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSend = async () => {
    if (busy || !request.trim()) return;
    const text = request.trim();
    const imagesToSend = attachedImages.map(img => ({ mimeType: img.mimeType, data: img.data }));

    // Clear state
    onRequestChange("");
    setAttachedImages([]);

    // 1. Slash commands preprocessing
    if (text.startsWith("/mcp")) {
      if (!window.nexcode) return;
      try {
        const servers = await window.nexcode.listMcpServers();
        let srvInfo = "🔌 Aktif MCP Sunucuları:\n";
        if (servers.length === 0) {
          srvInfo += "Kayıtlı MCP sunucusu bulunmuyor.";
        } else {
          for (const s of servers) {
            srvInfo += `• ${s.name} [${s.running ? "ÇALIŞIYOR" : "PASİF"}] (${s.command})\n`;
          }
        }
        setChat((c) => [
          ...c,
          { kind: "user", text, images: imagesToSend },
          { kind: "system", text: srvInfo },
        ]);
      } catch (e) {
        console.error(e);
      }
      return;
    }

    if (text.startsWith("/skill")) {
      if (!window.nexcode) return;
      const parts = text.split(" ");
      const cmd = parts[1];
      const rest = parts.slice(2).join(" ");
      try {
        const skills = await window.nexcode.listSkills();

        if (!cmd || cmd === "list") {
          let info = "💡 Mevcut Skills:\n";
          if (skills.length === 0) {
            info += "Kayıtlı skill bulunmuyor. MCP & Skills sekmesinden yeni skill ekleyin.";
          } else {
            for (const sk of skills) {
              info += `• /skill ${sk.name} : ${sk.description || "Açıklama yok"}\n`;
            }
          }
          setChat((c) => [
            ...c,
            { kind: "user", text, images: imagesToSend },
            { kind: "system", text: info },
          ]);
          return;
        }

        const target = skills.find((sk) => sk.name === cmd);
        if (!target) {
          setChat((c) => [
            ...c,
            { kind: "user", text, images: imagesToSend },
            { kind: "system", text: `Hata: '${cmd}' adında bir skill bulunamadı.` },
          ]);
          return;
        }

        const expandedPrompt = `[Skill: ${target.name}]\n${target.prompt}\n\n${rest}`;
        onPlan(expandedPrompt, imagesToSend);
      } catch (e) {
        console.error(e);
      }
      return;
    }

    // Standard Planning Request
    onPlan(text, imagesToSend);
  };

  return (
    <div className="flex h-full flex-col bg-ink-950/20">
      <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-900/40 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-300">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulse" /> Orkestrasyon & Vibe Coding
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {chat.length === 0 && (
          <div className="text-[11px] text-neutral-500 bg-ink-900/20 border border-ink-800 rounded-lg p-3 space-y-1.5">
            <p className="font-bold text-neutral-300">NEXCODE Çoklu-Agent IDE</p>
            <p>Bir talimat yazarak planlamayı başlatın. Örn: <code className="text-brand-300">"Kullanıcı kayıt sayfası tasarla"</code></p>
            <p className="pt-1 text-neutral-400">Komutlar:</p>
            <p className="font-mono text-[10px] text-brand-400/80">/mcp - MCP sunucularını listeler</p>
            <p className="font-mono text-[10px] text-brand-400/80">/skill - Kayıtlı prompt şablonlarını listeler</p>
          </div>
        )}
        {chat.map((m, i) => (
          <div
            key={i}
            className={`rounded-xl border p-3 text-xs shadow-sm transition-all hover:shadow-glow-sm ${
              m.kind === "user"
                ? "ml-6 border-brand-500/20 bg-brand-500/5 text-brand-100"
                : m.kind === "agent"
                  ? "mr-6 border-ink-700 bg-ink-900/40 text-neutral-200"
                  : "mr-6 border-violet-500/10 bg-violet-950/5 text-violet-300"
            }`}
          >
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-neutral-500">
              {m.kind === "user" ? "Sen" : m.kind === "agent" ? "Agent Çıktısı" : "Sistem"}
            </div>
            <pre className="whitespace-pre-wrap break-words font-sans leading-relaxed">{m.text}</pre>
            
            {/* Visual Previews in Chat History */}
            {m.images && m.images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.images.map((img, idx) => (
                  <img
                    key={idx}
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="Uploaded image"
                    className="max-h-40 max-w-full rounded-lg border border-ink-750/70 object-contain hover:scale-[1.02] transition duration-200"
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pending Approvals */}
      {approvals.length > 0 && (
        <div className="border-t border-amber-500/20 bg-amber-500/5 p-2.5">
          <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" /> Onay bekleyen eylemler ({approvals.length})
          </p>
          <div className="space-y-1.5">
            {approvals.map((ap) => (
              <div key={ap.id} className="flex items-center justify-between rounded-lg bg-ink-900/80 border border-amber-500/20 px-2 py-1.5 text-[11px]">
                <span className="text-neutral-300 font-mono text-[10px]">
                  {ap.actionType} · {ap.taskId.slice(0, 8)}
                </span>
                <span className="flex gap-1.5">
                  <button
                    onClick={() => onResolve(ap.id, "approved")}
                    disabled={busy}
                    className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/35 transition"
                  >
                    Onayla
                  </button>
                  <button
                    onClick={() => onResolve(ap.id, "rejected")}
                    disabled={busy}
                    className="rounded-md bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/35 transition"
                  >
                    Reddet
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dispatchable Backlog */}
      {backlog.length > 0 && (
        <div className="border-t border-ink-700 bg-ink-900/20 p-2.5">
          <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-brand-300">
            Hazır Görevler ({backlog.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {backlog.map((t) => (
              <button
                key={t.id}
                onClick={() => onDispatch(t.id)}
                disabled={busy}
                title={t.title}
                className="max-w-[200px] truncate rounded-lg border border-brand-500/20 bg-brand-500/10 px-2.5 py-1 text-[10px] text-brand-200 transition hover:bg-brand-500/20 disabled:opacity-40"
              >
                ▶ {t.assignedRole ?? "?"}: {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div 
        className="border-t border-ink-700 bg-ink-900/60 p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* File preview bar */}
        {attachedImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachedImages.map((img, idx) => (
              <div key={idx} className="relative group rounded-md border border-brand-500/35 overflow-hidden h-12 w-12 bg-ink-950">
                <img
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt="Thumbnail"
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeAttachedImage(idx)}
                  className="absolute top-0.5 right-0.5 bg-rose-600 text-white rounded-full h-3.5 w-3.5 flex items-center justify-center text-[9px] hover:bg-rose-700 shadow-md"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 bg-ink-950/80 border border-ink-700 focus-within:border-brand-500/70 rounded-xl px-2.5 py-2 transition-all">
          {/* File attachment trigger */}
          <button
            type="button"
            disabled={!available || busy}
            onClick={() => fileInputRef.current?.click()}
            className="p-1 rounded-lg hover:bg-ink-800 text-neutral-400 hover:text-brand-300 transition shrink-0"
            title="Fotoğraf ekle (Sürükleyip bırakabilirsiniz)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="2 2 20 20" strokeWidth="2" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.5l-10.94 10.94a1.5 1.5 0 11-2.12-2.12l7.424-7.424" />
            </svg>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            multiple
            onChange={handleFileChange}
          />

          <textarea
            value={request}
            onChange={(e) => onRequestChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            onPaste={handlePaste}
            placeholder="Planlama isteği yazın veya resim sürükleyin..."
            rows={2}
            className="w-full resize-none bg-transparent text-[11px] text-neutral-100 placeholder:text-neutral-500 outline-none min-h-[36px]"
          />

          <button
            onClick={handleSend}
            disabled={!available || busy || !request.trim()}
            className="p-1.5 rounded-lg bg-brand-grad hover:brightness-110 text-white transition shrink-0 disabled:opacity-40"
            title="Gönder"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

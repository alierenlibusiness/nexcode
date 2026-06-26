"use client";

import type { Task } from "@nexcode/core";
import type { ApprovalDTO } from "../../global";

export interface ChatEntry {
  kind: "user" | "system" | "agent";
  text: string;
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
}: {
  chat: ChatEntry[];
  request: string;
  busy: boolean;
  available: boolean;
  approvals: ApprovalDTO[];
  backlog: Task[];
  onRequestChange: (v: string) => void;
  onPlan: () => void;
  onDispatch: (taskId: string) => void;
  onResolve: (id: string, decision: "approved" | "rejected") => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-400" /> Vibe Coding · CEO Orkestrasyon
      </div>

      <div className="flex-1 space-y-2 overflow-auto p-3">
        {chat.length === 0 && (
          <p className="text-[11px] text-neutral-600">
            Bir istek yaz — CEO planlar, görevleri agent'lara dağıtır.
          </p>
        )}
        {chat.map((m, i) => (
          <div
            key={i}
            className={`rounded-lg px-3 py-2 text-xs ${
              m.kind === "user"
                ? "ml-6 border border-brand-700/40 bg-brand-500/10 text-brand-100"
                : m.kind === "agent"
                  ? "mr-6 border border-ink-700 bg-ink-800/60 text-neutral-200"
                  : "mr-6 border border-ink-700/60 bg-ink-900/60 text-neutral-400"
            }`}
          >
            <pre className="whitespace-pre-wrap break-words font-sans">{m.text}</pre>
          </div>
        ))}
      </div>

      {/* Bekleyen onaylar */}
      {approvals.length > 0 && (
        <div className="border-t border-amber-500/20 bg-amber-500/5 p-2">
          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            Onay bekleyen ({approvals.length})
          </p>
          {approvals.map((ap) => (
            <div key={ap.id} className="flex items-center justify-between px-1 py-0.5 text-[11px]">
              <span className="text-neutral-300">
                {ap.actionType} · {ap.taskId.slice(0, 8)}
              </span>
              <span className="flex gap-1">
                <button
                  onClick={() => onResolve(ap.id, "approved")}
                  disabled={busy}
                  className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-500/30"
                >
                  Onayla
                </button>
                <button
                  onClick={() => onResolve(ap.id, "rejected")}
                  disabled={busy}
                  className="rounded bg-rose-500/20 px-1.5 py-0.5 text-rose-300 hover:bg-rose-500/30"
                >
                  Reddet
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Dağıtılabilir görevler */}
      {backlog.length > 0 && (
        <div className="border-t border-ink-700 p-2">
          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Backlog → dispatch ({backlog.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {backlog.map((t) => (
              <button
                key={t.id}
                onClick={() => onDispatch(t.id)}
                disabled={busy}
                title={t.title}
                className="max-w-[180px] truncate rounded-md border border-brand-700/40 bg-brand-500/10 px-2 py-0.5 text-[10px] text-brand-200 transition hover:bg-brand-500/20 disabled:opacity-40"
              >
                ▶ {t.assignedRole ?? "?"}: {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-ink-700 p-2">
        <textarea
          value={request}
          onChange={(e) => onRequestChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onPlan();
          }}
          placeholder="Örn: Kullanıcı giriş özelliği ekle  (Ctrl+Enter)"
          rows={2}
          className="field mb-1 w-full resize-none text-xs"
        />
        <button onClick={onPlan} disabled={!available || busy || !request.trim()} className="btn-brand w-full py-1.5 text-xs">
          CEO ile planla →
        </button>
      </div>
    </div>
  );
}

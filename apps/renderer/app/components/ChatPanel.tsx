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
      <div className="border-b border-neutral-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        Vibe Coding · CEO Orkestrasyon
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
            className={`rounded-md px-3 py-2 text-xs ${
              m.kind === "user"
                ? "ml-6 bg-violet-500/15 text-violet-100"
                : m.kind === "agent"
                  ? "mr-6 bg-neutral-800/60 text-neutral-200"
                  : "mr-6 bg-neutral-900/60 text-neutral-400"
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
        <div className="border-t border-neutral-800 p-2">
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
                className="max-w-[180px] truncate rounded bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-200 hover:bg-violet-500/25 disabled:opacity-40"
              >
                ▶ {t.assignedRole ?? "?"}: {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-neutral-800 p-2">
        <textarea
          value={request}
          onChange={(e) => onRequestChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onPlan();
          }}
          placeholder="Örn: Kullanıcı giriş özelliği ekle  (Ctrl+Enter)"
          rows={2}
          className="mb-1 w-full resize-none rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs outline-none focus:border-neutral-500"
        />
        <button
          onClick={onPlan}
          disabled={!available || busy || !request.trim()}
          className="w-full rounded-md bg-violet-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
        >
          CEO ile planla →
        </button>
      </div>
    </div>
  );
}

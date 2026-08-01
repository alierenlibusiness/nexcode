"use client";

import type { ReactElement } from "react";

import type { TaskSummary } from "@nexcode/core";
import type { EngineViewState } from "../lib/engine-store";

/**
 * Pano.
 *
 * Görev yaşam döngüsünü sütunlarla gösterir. Salt görseldir: kartlar sürüklenmez, çünkü
 * durum motorun gerçeğidir, kullanıcının sürüklemesi değil. Aktif görev vurgulanır.
 */

const COLUMNS = [
  { key: "pending", label: "Bekliyor", accent: "border-neutral-600", dot: "bg-neutral-500" },
  { key: "running", label: "Çalışıyor", accent: "border-brand-500/60", dot: "bg-brand-400" },
  { key: "done", label: "Tamamlandı", accent: "border-emerald-500/40", dot: "bg-emerald-400" },
  { key: "failed", label: "Başarısız", accent: "border-rose-500/40", dot: "bg-rose-400" },
] as const;

export function BoardView({ state }: { state: EngineViewState }): ReactElement {
  const activeIds = new Set(state.status?.activeTaskIds ?? []);

  // Çalışan görevler kuyruk anlık görüntüsünde `pending` altında görünmez; motor durumundan
  // gelen aktif id'ler onları kendi sütununa taşır.
  const running = [...state.queue.pending, ...state.queue.approval].filter((task) => activeIds.has(task.id));
  const waiting = state.queue.pending.filter((task) => !activeIds.has(task.id));

  const byColumn: Record<string, TaskSummary[]> = {
    pending: waiting,
    running,
    done: state.queue.done,
    failed: state.queue.failed,
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {state.queue.approval.length > 0 && (
        <div className="panel border-amber-500/40 px-4 py-2.5 text-sm text-amber-200">
          {String(state.queue.approval.length)} görev insan onayı bekliyor. Komuta Merkezi'nden karar ver.
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((column) => {
          const tasks = byColumn[column.key] ?? [];
          return (
            <section key={column.key} className={`panel flex min-h-0 flex-col border-t-2 ${column.accent}`}>
              <header className="flex items-center gap-2 border-b border-ink-700 px-3 py-2.5">
                <span className={`h-2 w-2 rounded-full ${column.dot}`} />
                <h2 className="text-sm font-semibold text-neutral-200">{column.label}</h2>
                <span className="ml-auto rounded bg-ink-800 px-1.5 text-xs tabular-nums text-neutral-400">
                  {String(tasks.length)}
                </span>
              </header>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
                {tasks.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-neutral-600">Boş</p>
                ) : (
                  tasks.map((task) => (
                    <TaskCard key={task.id} task={task} active={activeIds.has(task.id)} />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({ task, active }: { task: TaskSummary; active: boolean }): ReactElement {
  return (
    <article
      className={`rounded-lg border bg-ink-950/60 p-3 transition ${
        active ? "border-brand-500/60 shadow-glow-sm" : "border-ink-700 hover:border-ink-600"
      }`}
    >
      <p className="line-clamp-3 text-sm leading-relaxed text-neutral-200">{task.prompt}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-neutral-400">{task.executionMode}</span>
        {task.scheduleId !== null && (
          <span className="rounded bg-brand-900/50 px-1.5 py-0.5 text-brand-300">zamanlanmış</span>
        )}
        {task.changedFiles > 0 && (
          <span className="rounded bg-ink-800 px-1.5 py-0.5 tabular-nums text-neutral-400">
            {String(task.changedFiles)} dosya
          </span>
        )}
      </div>

      <div className="mt-2 truncate text-[11px] text-neutral-600" title={task.workingDir}>
        {task.workingDir}
      </div>
    </article>
  );
}

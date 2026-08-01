"use client";

import { useEffect, useState, type ReactElement } from "react";
import type { EngineViewState, TimelineEntry } from "../lib/engine-store";
import { useKpis } from "../lib/engine-store";
import type { ApprovalDTO, EngineStatusDTO } from "../../global";

/**
 * Komuta Merkezi.
 *
 * Tek ekranda: görev oluşturma, kuyruk, canlı olay akışı, onay kartı ve motor kontrolleri.
 * Kullanıcının motoru başlatıp bir hedef yazması dışında hiçbir şey gerekmez.
 */

const MODES = [
  { id: "auto", label: "Otomatik", hint: "Hedefin büyüklüğüne göre motor karar verir" },
  { id: "fast", label: "Hızlı", hint: "Tek uygulayıcı, en az tur" },
  { id: "balanced", label: "Dengeli", hint: "Plan, uygulama ve bağımsız inceleme" },
  { id: "deep", label: "Derin", hint: "Ayrı planlama turu ve daha çok inceleme" },
] as const;

export function CommandCenter({ state }: { state: EngineViewState }): ReactElement {
  const kpis = useKpis(state);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<string>("auto");
  const [engine, setEngine] = useState<EngineStatusDTO | null>(null);
  const [approvals, setApprovals] = useState<ApprovalDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshSide = async (): Promise<void> => {
    const api = window.nexcode;
    if (api === undefined) return;
    setEngine(await api.engineStatus());
    setApprovals(await api.listPendingApprovals());
  };

  useEffect(() => {
    void refreshSide();
    const timer = setInterval(() => void refreshSide(), 4000);
    return () => clearInterval(timer);
  }, []);

  const submit = async (): Promise<void> => {
    const api = window.nexcode;
    if (api === undefined || prompt.trim() === "") return;

    setBusy(true);
    setError(null);
    try {
      await api.createTask({ prompt: prompt.trim(), executionMode: mode });
      setPrompt("");
      await state.refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleEngine = async (): Promise<void> => {
    const api = window.nexcode;
    if (api === undefined) return;

    setError(null);
    try {
      setEngine(engine?.running === true ? await api.engineStop() : await api.engineStart());
    } catch (cause) {
      // En sık neden: otonom çalışma onayı verilmemiş olması.
      setError(String(cause));
    }
  };

  const decide = async (id: string, status: "approved" | "rejected"): Promise<void> => {
    await window.nexcode?.resolveApproval(id, status);
    await refreshSide();
  };

  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-h-0 flex-col gap-4">
        <KpiStrip kpis={kpis} />

        <section className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-200">Yeni görev</h2>
            <div className="flex gap-1">
              {MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  title={option.hint}
                  onClick={() => setMode(option.id)}
                  className={`rounded-md px-2.5 py-1 text-xs transition ${
                    mode === option.id
                      ? "bg-brand-grad font-semibold text-white"
                      : "border border-ink-700 text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
            rows={3}
            placeholder="Ne yapılmasını istiyorsun? Örnek: avatar yükleme akışını ekle ve testlerini yaz."
            className="field w-full resize-none"
          />

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-neutral-500">Göndermek için Ctrl+Enter</span>
            <button type="button" className="btn-brand" disabled={busy || prompt.trim() === ""} onClick={() => void submit()}>
              {busy ? "Ekleniyor..." : "Kuyruğa ekle"}
            </button>
          </div>
          {error !== null && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        </section>

        <ActivityStream timeline={state.timeline} />
      </div>

      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <EngineControl engine={engine} onToggle={() => void toggleEngine()} />
        {approvals.length > 0 && <ApprovalCard approvals={approvals} onDecide={decide} />}
        <QueueCard state={state} />
      </aside>
    </div>
  );
}

function KpiStrip({ kpis }: { kpis: ReturnType<typeof useKpis> }): ReactElement {
  const items = [
    { label: "Tur", value: kpis.rounds },
    { label: "Delegasyon", value: kpis.delegations },
    { label: "Aktif görev", value: kpis.activeAgents },
    { label: "Değişen dosya", value: kpis.changedFiles },
    { label: "Çağrı", value: `${String(kpis.calls)}/${String(kpis.budget)}` },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="panel px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">{item.label}</div>
          <div className="text-lg font-semibold tabular-nums text-neutral-100">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function EngineControl({ engine, onToggle }: { engine: EngineStatusDTO | null; onToggle: () => void }): ReactElement {
  const running = engine?.running ?? false;
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${running ? "animate-pulse bg-emerald-400" : "bg-neutral-600"}`} />
        <h2 className="text-sm font-semibold text-neutral-200">{running ? "Motor çalışıyor" : "Motor durdu"}</h2>
      </div>

      <dl className="mb-3 space-y-1 text-xs text-neutral-400">
        <div className="flex justify-between">
          <dt>Slot</dt>
          <dd className="tabular-nums text-neutral-200">
            {String(engine?.activeIds.length ?? 0)} / {String(engine?.concurrency ?? 1)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Boş slot</dt>
          <dd className="tabular-nums text-neutral-200">{String(engine?.freeSlots ?? 0)}</dd>
        </div>
      </dl>

      <button type="button" onClick={onToggle} className={running ? "btn-ghost w-full" : "btn-brand w-full"}>
        {running ? "Durdur" : "Başlat"}
      </button>
      {running && (
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          Durdurma uçuştaki görevi yarıda kesmez; biten işten sonra yeni görev alınmaz.
        </p>
      )}
    </section>
  );
}

function ApprovalCard({
  approvals,
  onDecide,
}: {
  approvals: ApprovalDTO[];
  onDecide: (id: string, status: "approved" | "rejected") => Promise<void>;
}): ReactElement {
  return (
    <section className="panel border-amber-500/40 p-4">
      <h2 className="mb-2 text-sm font-semibold text-amber-300">Onay bekliyor</h2>
      <ul className="space-y-3">
        {approvals.map((approval) => (
          <li key={approval.id} className="rounded-lg border border-ink-700 bg-ink-950/60 p-3">
            <div className="text-xs text-neutral-400">{approval.actionType}</div>
            <div className="mb-2 truncate text-sm text-neutral-200">Görev: {approval.taskId}</div>
            <div className="flex gap-2">
              <button type="button" className="btn-brand flex-1 py-1 text-xs" onClick={() => void onDecide(approval.id, "approved")}>
                Onayla
              </button>
              <button type="button" className="btn-ghost flex-1 py-1 text-xs" onClick={() => void onDecide(approval.id, "rejected")}>
                Reddet
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function QueueCard({ state }: { state: EngineViewState }): ReactElement {
  const pending = state.queue.pending;
  return (
    <section className="panel p-4">
      <h2 className="mb-2 text-sm font-semibold text-neutral-200">Kuyruk ({String(pending.length)})</h2>
      {pending.length === 0 ? (
        <p className="text-xs text-neutral-500">Bekleyen görev yok.</p>
      ) : (
        <ul className="space-y-2">
          {pending.map((task) => (
            <li key={task.id} className="rounded-lg border border-ink-700 bg-ink-950/60 px-3 py-2">
              <div className="truncate text-sm text-neutral-200">{task.prompt}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                <span className="rounded bg-ink-800 px-1.5 py-0.5">{task.executionMode}</span>
                {task.scheduleId !== null && <span className="text-brand-300">zamanlanmış</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityStream({ timeline }: { timeline: TimelineEntry[] }): ReactElement {
  return (
    <section className="panel flex min-h-0 flex-1 flex-col">
      <h2 className="border-b border-ink-700 px-4 py-2.5 text-sm font-semibold text-neutral-200">Canlı akış</h2>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {timeline.length === 0 ? (
          <p className="p-4 text-center text-xs text-neutral-500">
            Henüz olay yok. Motoru başlatıp bir görev ekle.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {[...timeline].reverse().map((entry) => (
              <li key={entry.seq} className="flex gap-3 rounded-lg px-2 py-1.5 hover:bg-ink-800/50">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${toneDot(entry.tone)}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm text-neutral-200">{entry.title}</span>
                    <time className="shrink-0 text-[11px] tabular-nums text-neutral-600">{clock(entry.ts)}</time>
                  </div>
                  {entry.detail !== "" && (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-neutral-500">{entry.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function toneDot(tone: TimelineEntry["tone"]): string {
  const map = { neutral: "bg-brand-400", good: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-rose-400" };
  return map[tone];
}

function clock(ts: string): string {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(undefined, { hour12: false });
}

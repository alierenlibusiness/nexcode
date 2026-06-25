"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task, AgentRole, ConnectionPreference, TaskStatus } from "@nexcode/core";
import type { ApprovalDTO } from "../global";
import { AGENT_CARDS } from "./agents";

const FAZ1_ROLES: readonly AgentRole[] = ["ceo", "frontend", "backend"];

const CONNECTION_OPTIONS: ReadonlyArray<{ value: ConnectionPreference; label: string }> = [
  { value: "api_only", label: "API" },
  { value: "cli_only", label: "CLI" },
  { value: "cli_first", label: "CLI→API" },
];

const BOARD_COLUMNS: ReadonlyArray<{ status: TaskStatus; label: string }> = [
  { status: "backlog", label: "Backlog" },
  { status: "in_progress", label: "In Progress" },
  { status: "review", label: "Review" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

function ConnectionToggle({
  value,
  disabled,
  onChange,
}: {
  value: ConnectionPreference | undefined;
  disabled: boolean;
  onChange: (pref: ConnectionPreference) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-neutral-700 text-[10px]">
      {CONNECTION_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`px-2 py-0.5 transition ${
            value === opt.value
              ? "bg-violet-500/30 text-violet-200"
              : "text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function HomePage() {
  const [available, setAvailable] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<ApprovalDTO[]>([]);
  const [connections, setConnections] = useState<Partial<Record<AgentRole, ConnectionPreference>>>(
    {},
  );
  const [request, setRequest] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const api = window.nexcode;
    if (!api) return;
    const [t, a, c] = await Promise.all([
      api.listTasks(),
      api.listPendingApprovals(),
      api.getConnections(),
    ]);
    setTasks(t);
    setApprovals(a);
    setConnections(c);
  }, []);

  useEffect(() => {
    const api = window.nexcode;
    if (!api) {
      setStatus("Tarayıcı önizlemesi: IPC köprüsü yalnızca Electron içinde aktiftir.");
      return;
    }
    setAvailable(true);
    void api.hasApiKey("anthropic").then(setHasKey);
    void refresh();
  }, [refresh]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setStatus(label);
    try {
      await fn();
      setStatus(`${label} ✓`);
    } catch (error) {
      setStatus(`Hata: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const onPlan = () =>
    run("CEO planlıyor…", async () => {
      if (!window.nexcode || !request.trim()) return;
      await window.nexcode.planRequest(request.trim());
      setRequest("");
      await refresh();
    });

  const onDispatch = (taskId: string) =>
    run("Agent çalışıyor…", async () => {
      if (!window.nexcode) return;
      const { output } = await window.nexcode.dispatchTask(taskId);
      await refresh();
      setStatus(`Çıktı: ${output.slice(0, 120)}${output.length > 120 ? "…" : ""}`);
    });

  const onResolve = (id: string, decision: "approved" | "rejected") =>
    run(`Onay: ${decision}`, async () => {
      if (!window.nexcode) return;
      await window.nexcode.resolveApproval(id, decision);
      await refresh();
    });

  const onConnection = (role: AgentRole, pref: ConnectionPreference) =>
    run(`${role} → ${pref}`, async () => {
      if (!window.nexcode) return;
      await window.nexcode.setConnection(role, pref);
      setConnections((prev) => ({ ...prev, [role]: pref }));
    });

  const onSaveKey = () =>
    run("Anahtar kaydedildi", async () => {
      if (!window.nexcode || !apiKey.trim()) return;
      await window.nexcode.setApiKey("anthropic", apiKey.trim());
      setApiKey("");
      setHasKey(true);
    });

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">NEXCODE</h1>
          <p className="text-sm text-neutral-400">Faz 1 — orkestrasyon (CEO → plan → onay → dispatch)</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded px-2 py-1 ${hasKey ? "bg-emerald-500/15 text-emerald-300" : "bg-neutral-800 text-neutral-400"}`}>
            Anthropic API: {hasKey ? "ayarlı" : "yok"}
          </span>
        </div>
      </header>

      {status && (
        <div className="mb-5 rounded-md border border-neutral-800 bg-neutral-900/60 px-4 py-2 text-sm text-neutral-300">
          {status}
        </div>
      )}

      {/* API anahtarı + istek */}
      <section className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Anthropic API anahtarı (keychain)
          </h2>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-…"
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <button
              onClick={onSaveKey}
              disabled={!available || busy}
              className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
            >
              Kaydet
            </button>
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">
            CLI modu için anahtar gerekmez; sistemde kurulu <code>claude</code> CLI kullanılır.
          </p>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            İstek → CEO planı
          </h2>
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="Örn: Kullanıcı giriş özelliği ekle"
            rows={2}
            className="mb-2 w-full resize-none rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <button
            onClick={onPlan}
            disabled={!available || busy || !request.trim()}
            className="rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40"
          >
            CEO ile planla
          </button>
        </div>
      </section>

      {/* Agent grid + bağlantı modu */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Agent ekibi — bağlantı modu (API / CLI senin seçimin)
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AGENT_CARDS.map((agent) => {
            const isFaz1 = FAZ1_ROLES.includes(agent.role);
            return (
              <article
                key={agent.role}
                className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{agent.title}</h3>
                  {isFaz1 ? (
                    <ConnectionToggle
                      value={connections[agent.role]}
                      disabled={!available || busy}
                      onChange={(pref) => onConnection(agent.role, pref)}
                    />
                  ) : (
                    <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
                      Faz 2
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-neutral-500">{agent.model}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* Onay paneli */}
      {approvals.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-amber-400">
            Bekleyen onaylar ({approvals.length})
          </h2>
          <ul className="space-y-2">
            {approvals.map((ap) => (
              <li
                key={ap.id}
                className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"
              >
                <span className="text-neutral-200">
                  <span className="font-medium text-amber-300">{ap.actionType}</span> — görev {ap.taskId.slice(0, 8)}
                </span>
                <span className="flex gap-2">
                  <button
                    onClick={() => onResolve(ap.id, "approved")}
                    disabled={busy}
                    className="rounded bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/30"
                  >
                    Onayla
                  </button>
                  <button
                    onClick={() => onResolve(ap.id, "rejected")}
                    disabled={busy}
                    className="rounded bg-rose-500/20 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/30"
                  >
                    Reddet
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Task board */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Task board ({tasks.length})
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {BOARD_COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.status);
            return (
              <div key={col.status} className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-2">
                <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  {col.label} ({colTasks.length})
                </h3>
                <ul className="space-y-2">
                  {colTasks.map((t) => (
                    <li key={t.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-2 text-xs">
                      <p className="mb-1 text-neutral-200">{t.title}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-neutral-500">{t.assignedRole ?? "—"}</span>
                        {t.status === "backlog" && (
                          <button
                            onClick={() => onDispatch(t.id)}
                            disabled={busy}
                            className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300 hover:bg-violet-500/30"
                          >
                            Dispatch
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

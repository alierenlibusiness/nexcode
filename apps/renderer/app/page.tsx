"use client";

import { useState } from "react";
import type { Workspace, ConnectionMode, AutonomyLevel } from "@nexcode/core";
import { AGENT_CARDS } from "./agents";

function ConnectionBadge({ mode }: { mode: ConnectionMode }) {
  const isCli = mode === "cli";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        isCli ? "bg-violet-500/15 text-violet-300" : "bg-sky-500/15 text-sky-300"
      }`}
    >
      {isCli ? "CLI" : "API"}
    </span>
  );
}

function AutonomyBadge({ level }: { level: AutonomyLevel }) {
  const color: Record<AutonomyLevel, string> = {
    manual: "bg-amber-500/15 text-amber-300",
    supervised: "bg-emerald-500/15 text-emerald-300",
    autonomous: "bg-rose-500/15 text-rose-300",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${color[level]}`}>
      {level}
    </span>
  );
}

export default function HomePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [status, setStatus] = useState<string>("");

  async function handleCreateWorkspace() {
    if (!window.nexcode) {
      setStatus("Tarayıcı önizlemesi: IPC köprüsü yalnızca Electron içinde aktiftir.");
      return;
    }
    try {
      const created = await window.nexcode.createWorkspace({
        name: `Workspace ${new Date().toLocaleTimeString("tr-TR")}`,
        repoPath: "C:/Users/alier/Projects/NEXCODE",
      });
      const all = await window.nexcode.listWorkspaces();
      setWorkspaces(all);
      setStatus(`Oluşturuldu: ${created.name} (${created.id.slice(0, 8)}…)`);
    } catch (error) {
      setStatus(`Hata: ${String(error)}`);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">NEXCODE</h1>
          <p className="text-sm text-neutral-400">
            Çoklu-agent, paralel vibe coding ortamı — Faz 0 iskeleti
          </p>
        </div>
        <button
          onClick={handleCreateWorkspace}
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-white"
        >
          Workspace oluştur
        </button>
      </header>

      {status && (
        <div className="mb-6 rounded-md border border-neutral-800 bg-neutral-900/60 px-4 py-2 text-sm text-neutral-300">
          {status}
        </div>
      )}

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Agent ekibi
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AGENT_CARDS.map((agent) => (
            <article
              key={agent.role}
              className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 transition hover:border-neutral-700"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-neutral-100">{agent.title}</h3>
                <div className="flex items-center gap-1">
                  <ConnectionBadge mode={agent.connectionMode} />
                  <AutonomyBadge level={agent.autonomy} />
                </div>
              </div>
              <p className="mb-3 text-xs text-neutral-400">{agent.summary}</p>
              <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                <span className="inline-block h-2 w-2 rounded-full bg-neutral-600" aria-hidden />
                <span className="truncate">{agent.model}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {workspaces.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Workspace&apos;ler ({workspaces.length})
          </h2>
          <ul className="space-y-1 text-sm text-neutral-300">
            {workspaces.map((ws) => (
              <li key={ws.id} className="rounded border border-neutral-800 px-3 py-2">
                {ws.name} — <span className="text-neutral-500">{ws.repoPath}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

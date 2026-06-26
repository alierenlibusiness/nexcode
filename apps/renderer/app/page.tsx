"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task, AgentRole, ConnectionPreference } from "@nexcode/core";
import type {
  ApprovalDTO,
  FsEntryDTO,
  FileContentDTO,
  ProviderInfoDTO,
  AgentModelMap,
  CostSummaryDTO,
} from "../global";
import { FileTree } from "./components/FileTree";
import { CodeViewer } from "./components/CodeViewer";
import { TerminalPanel } from "./components/TerminalPanel";
import { ChatPanel, type ChatEntry } from "./components/ChatPanel";
import { AgentPanel } from "./components/AgentPanel";

export default function HomePage() {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  // Dosya sistemi / IDE
  const [root, setRoot] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntryDTO[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContentDTO | null>(null);

  // Orkestrasyon
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<ApprovalDTO[]>([]);
  const [connections, setConnections] = useState<Partial<Record<AgentRole, ConnectionPreference>>>({});
  const [request, setRequest] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);

  // Model seçimi / sağlayıcılar
  const [providers, setProviders] = useState<ProviderInfoDTO[]>([]);
  const [agentModels, setAgentModels] = useState<AgentModelMap>({});
  const [cost, setCost] = useState<CostSummaryDTO | null>(null);

  // API anahtarı yönetimi
  const [keyProvider, setKeyProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");

  const [tab, setTab] = useState<"chat" | "agents">("chat");

  const refresh = useCallback(async () => {
    const api = window.nexcode;
    if (!api) return;
    const [t, a, c, m, cs] = await Promise.all([
      api.listTasks(),
      api.listPendingApprovals(),
      api.getConnections(),
      api.getAgentModels(),
      api.getCostSummary(),
    ]);
    setTasks(t);
    setApprovals(a);
    setConnections(c);
    setAgentModels(m);
    setCost(cs);
  }, []);

  useEffect(() => {
    const api = window.nexcode;
    if (!api) {
      setStatus("Tarayıcı önizlemesi: IPC köprüsü yalnızca Electron içinde aktiftir.");
      return;
    }
    setAvailable(true);
    void (async () => {
      const [listing, provs] = await Promise.all([api.currentRoot(), api.listProviders()]);
      setRoot(listing.root);
      setEntries(listing.entries);
      setProviders(provs);
      await refresh();
    })();
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

  const onOpenFolder = () =>
    run("Klasör açılıyor", async () => {
      if (!window.nexcode) return;
      const listing = await window.nexcode.openFolder();
      setRoot(listing.root);
      setEntries(listing.entries);
      setActivePath(null);
      setFileContent(null);
    });

  const onOpenFile = (path: string) =>
    run("Dosya açılıyor", async () => {
      if (!window.nexcode) return;
      setActivePath(path);
      setFileContent(null);
      setFileContent(await window.nexcode.readFile(path));
    });

  const onPlan = () =>
    run("CEO planlıyor…", async () => {
      if (!window.nexcode || !request.trim()) return;
      const text = request.trim();
      setChat((c) => [...c, { kind: "user", text }]);
      const created = await window.nexcode.planRequest(text);
      setRequest("");
      setChat((c) => [
        ...c,
        {
          kind: "system",
          text:
            `CEO ${String(created.length)} görev üretti:\n` +
            created.map((t) => `• [${t.assignedRole ?? "?"}] ${t.title}`).join("\n"),
        },
      ]);
      await refresh();
    });

  const onDispatch = (taskId: string) =>
    run("Agent çalışıyor…", async () => {
      if (!window.nexcode) return;
      const { output } = await window.nexcode.dispatchTask(taskId);
      setChat((c) => [...c, { kind: "agent", text: output }]);
      await refresh();
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

  const onModelChange = (role: AgentRole, provider: string, modelId: string) =>
    run(`${role} modeli → ${provider}/${modelId}`, async () => {
      if (!window.nexcode) return;
      await window.nexcode.setAgentModel(role, provider, modelId);
      await refresh();
    });

  const onSaveKey = () =>
    run(`${keyProvider} anahtarı kaydedildi`, async () => {
      if (!window.nexcode || !apiKey.trim()) return;
      await window.nexcode.setApiKey(keyProvider, apiKey.trim());
      setApiKey("");
    });

  const backlog = tasks.filter((t) => t.status === "backlog");
  const apiCost = cost?.totalApiCost ?? 0;

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      {/* Üst bar */}
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight">NEXCODE</span>
          <span className="text-[11px] text-neutral-500">Faz 2 · çoklu-agent IDE</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-400">
            Taşma (API) maliyeti: ${apiCost.toFixed(4)}
          </span>
          <span className="max-w-[260px] truncate text-neutral-500">{status}</span>
        </div>
      </header>

      {/* 3 panel */}
      <div className="flex min-h-0 flex-1">
        {/* Sol: dosya ağacı */}
        <aside className="w-60 shrink-0 border-r border-neutral-800 bg-neutral-900/30">
          <FileTree
            root={root}
            entries={entries}
            activePath={activePath}
            onOpenFile={onOpenFile}
            onOpenFolder={onOpenFolder}
          />
        </aside>

        {/* Orta: kod + terminal */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 border-b border-neutral-800">
            <CodeViewer file={fileContent} path={activePath} />
          </div>
          <div className="h-56 shrink-0">
            <TerminalPanel />
          </div>
        </main>

        {/* Sağ: chat / agents */}
        <aside className="flex w-96 shrink-0 flex-col border-l border-neutral-800 bg-neutral-900/30">
          <div className="flex border-b border-neutral-800 text-[11px]">
            {(["chat", "agents"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 font-semibold uppercase tracking-wider transition ${
                  tab === t ? "bg-neutral-800/60 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {t === "chat" ? "Sohbet" : "Agent & Model"}
              </button>
            ))}
          </div>

          {tab === "chat" ? (
            <div className="min-h-0 flex-1">
              <ChatPanel
                chat={chat}
                request={request}
                busy={busy}
                available={available}
                approvals={approvals}
                backlog={backlog}
                onRequestChange={setRequest}
                onPlan={onPlan}
                onDispatch={onDispatch}
                onResolve={onResolve}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {/* API anahtarları (her sağlayıcı için) */}
              <div className="mb-3 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  API anahtarı (OS keychain)
                </p>
                <div className="flex gap-1">
                  <select
                    value={keyProvider}
                    onChange={(e) => setKeyProvider(e.target.value)}
                    className="rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-[11px] outline-none"
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="anahtar…"
                    className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-[11px] outline-none focus:border-neutral-500"
                  />
                  <button
                    onClick={onSaveKey}
                    disabled={!available || busy || !apiKey.trim()}
                    className="rounded bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
                  >
                    Kaydet
                  </button>
                </div>
                <p className="mt-1 text-[9px] text-neutral-600">
                  CLI modu anahtar gerektirmez; sistemde kurulu CLI (claude/codex/antigravity) kullanılır.
                </p>
              </div>

              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Her agent için AI + bağlantı (senin seçimin)
              </p>
              <AgentPanel
                providers={providers}
                agentModels={agentModels}
                connections={connections}
                disabled={!available || busy}
                onModelChange={onModelChange}
                onConnectionChange={onConnection}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

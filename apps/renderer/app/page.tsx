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
  ConnectionStatusMap,
} from "../global";
import { FileTree } from "./components/FileTree";
import { CodeEditor } from "./components/CodeEditor";
import { TerminalPanel } from "./components/TerminalPanel";
import { ChatPanel, type ChatEntry } from "./components/ChatPanel";
import { AgentPanel } from "./components/AgentPanel";
import { ConnectionsPanel } from "./components/ConnectionsPanel";
import { McpSkillsPanel } from "./components/McpSkillsPanel";

type Tab = "chat" | "agents" | "mcp_skills" | "connections";

export default function HomePage() {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const [root, setRoot] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntryDTO[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContentDTO | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<ApprovalDTO[]>([]);
  const [connections, setConnections] = useState<Partial<Record<AgentRole, ConnectionPreference>>>({});
  const [request, setRequest] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);

  const [providers, setProviders] = useState<ProviderInfoDTO[]>([]);
  const [agentModels, setAgentModels] = useState<AgentModelMap>({});
  const [connStatus, setConnStatus] = useState<ConnectionStatusMap>({});
  const [cost, setCost] = useState<CostSummaryDTO | null>(null);

  const [tab, setTab] = useState<Tab>("chat");

  const refresh = useCallback(async () => {
    const api = window.nexcode;
    if (!api) return;
    const [t, a, c, m, cs, st] = await Promise.all([
      api.listTasks(),
      api.listPendingApprovals(),
      api.getConnections(),
      api.getAgentModels(),
      api.getCostSummary(),
      api.getConnectionStatus(),
    ]);
    setTasks(t);
    setApprovals(a);
    setConnections(c);
    setAgentModels(m);
    setCost(cs);
    setConnStatus(st);
  }, []);

  useEffect(() => {
    const api = window.nexcode;
    if (!api) {
      setStatus("Tarayıcı önizlemesi: IPC köprüsü yalnızca uygulama içinde aktiftir.");
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

  const onPlan = (text: string, images?: Array<{ mimeType: string; data: string }>) =>
    run("CEO planlıyor…", async () => {
      if (!window.nexcode || !text.trim()) return;
      setChat((c) => [...c, { kind: "user", text, images }]);
      const created = await window.nexcode.planRequest(text, images);
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
    run(`${role} → ${provider}/${modelId}`, async () => {
      if (!window.nexcode) return;
      await window.nexcode.setAgentModel(role, provider, modelId);
      await refresh();
    });

  const onSaveKey = async (provider: string, key: string) => {
    if (!window.nexcode) return;
    await run(`${provider} anahtarı kaydedildi`, async () => {
      await window.nexcode!.setApiKey(provider, key);
      await refresh();
    });
  };

  const backlog = tasks.filter((t) => t.status === "backlog");
  const apiCost = cost?.totalApiCost ?? 0;
  const cliCount = Object.values(connStatus).filter((s) => s.cliInstalled).length;
  const keyCount = Object.values(connStatus).filter((s) => s.hasApiKey).length;

  const tabLabels: Record<Tab, string> = { chat: "Sohbet", agents: "Ajanlar (Agents)", mcp_skills: "MCP & Skills", connections: "Bağlantı Ayarları" };

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-neutral-100">
      {/* Üst bar */}
      <header className="flex items-center justify-between border-b border-ink-700 bg-ink-900/60 px-4 py-2 backdrop-blur shadow-sm">
        <div className="flex items-center gap-2.5">
          <img src="./favicon.png" alt="NEXCODE" className="h-7 w-7 rounded-md ring-1 ring-ink-700" />
          <span className="text-base font-extrabold tracking-tight select-none">
            <span className="text-brand-grad font-black">NEX</span>
            <span className="text-chrome font-black">CODE</span>
          </span>
          <span className="ml-1 rounded bg-brand-500/10 border border-brand-500/20 px-1.5 py-0.5 text-[9px] text-brand-300 font-bold select-none uppercase tracking-wider">
            Multi-Agent IDE
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono select-none">
          <span className="rounded-lg border border-ink-700 bg-ink-800/40 px-2.5 py-1 text-neutral-400">
            API KEYS: {keyCount} · CLI TOOLS: {cliCount}
          </span>
          <span className="rounded-lg border border-ink-700 bg-ink-800/40 px-2.5 py-1 text-neutral-400">
            API COST: ${apiCost.toFixed(4)}
          </span>
          <span className="max-w-[240px] truncate text-brand-400 font-semibold">{status}</span>
        </div>
      </header>

      {/* 3 panel */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 border-r border-ink-700 bg-ink-900/30">
          <FileTree
            root={root}
            entries={entries}
            activePath={activePath}
            onOpenFile={onOpenFile}
            onOpenFolder={onOpenFolder}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 border-b border-ink-700">
            <CodeEditor file={fileContent} path={activePath} />
          </div>
          <div className="h-56 shrink-0">
            <TerminalPanel />
          </div>
        </main>

        <aside className="flex w-96 shrink-0 flex-col border-l border-ink-700 bg-ink-900/30">
          <div className="flex border-b border-ink-700 text-[11px]">
            {(["chat", "agents", "mcp_skills", "connections"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 font-semibold uppercase tracking-wider transition ${
                  tab === t
                    ? "border-b-2 border-brand-500 bg-ink-800/40 text-neutral-100"
                    : "border-b-2 border-transparent text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {tabLabels[t]}
              </button>
            ))}
          </div>

          {tab === "chat" && (
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
                setChat={setChat}
              />
            </div>
          )}

          {tab === "agents" && (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Her agent için AI + bağlantı modu (senin seçimin)
              </p>
              <AgentPanel
                providers={providers}
                agentModels={agentModels}
                connections={connections}
                status={connStatus}
                disabled={!available || busy}
                onModelChange={onModelChange}
                onConnectionChange={onConnection}
              />
            </div>
          )}

          {tab === "mcp_skills" && (
            <div className="min-h-0 flex-1 overflow-auto">
              <McpSkillsPanel disabled={!available || busy} />
            </div>
          )}

          {tab === "connections" && (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <ConnectionsPanel
                providers={providers}
                status={connStatus}
                disabled={!available || busy}
                onSaveKey={onSaveKey}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

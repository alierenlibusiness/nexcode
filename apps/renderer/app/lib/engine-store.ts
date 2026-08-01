"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActivityEvent,
  EngineEvent,
  EngineStatus,
  FileChangeSummary,
  LogEvent,
  MessageEvent,
  QueueSnapshot,
  ResultEvent,
} from "@nexcode/core";

/**
 * Motorun canlı akışını tek bir görünüm durumunda toplar.
 *
 * Replay sözleşmesi: sayfa açılışında kalıcı geçmiş okunur, bu sırada gelen canlı olaylar
 * tamponlanır ve `seq` numarasına göre tekilleştirilir. Geçmiş ile canlı akış aynı sayacı
 * paylaştığı için hiçbir olay iki kez işlenmez ve sıra bozulmaz.
 */

export interface TimelineEntry {
  seq: number;
  ts: string;
  kind: "activity" | "message" | "log" | "result";
  title: string;
  detail: string;
  agentId?: string;
  adapter?: string;
  tone: "neutral" | "good" | "warn" | "bad";
}

export interface EngineViewState {
  status: EngineStatus | null;
  queue: QueueSnapshot;
  timeline: TimelineEntry[];
  files: FileChangeSummary[];
  lineCounts: { added: number; removed: number };
  result: ResultEvent | null;
  /** Aktif ya da replay edilen görevin id'si. */
  taskId: string | null;
  connected: boolean;
  /** Kuyruk ve geçmişi sunucudan yeniden çeker. */
  refresh: () => Promise<void>;
}

const EMPTY_QUEUE: QueueSnapshot = { pending: [], approval: [], done: [], failed: [] };

const MAX_TIMELINE = 400;

export function useEngineStream(): EngineViewState {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [queue, setQueue] = useState<QueueSnapshot>(EMPTY_QUEUE);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [files, setFiles] = useState<FileChangeSummary[]>([]);
  const [lineCounts, setLineCounts] = useState({ added: 0, removed: 0 });
  const [result, setResult] = useState<ResultEvent | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  /** İşlenmiş olay numaraları: replay ile canlı akışın kesişimini tekilleştirir. */
  const seen = useRef<Set<number>>(new Set());

  const apply = useCallback((event: EngineEvent) => {
    if (seen.current.has(event.seq)) return;
    seen.current.add(event.seq);

    if (event.taskId !== null) setTaskId((current) => current ?? event.taskId);

    switch (event.type) {
      case "status":
        setStatus(event.payload);
        return;
      case "queue":
        setQueue(event.payload);
        return;
      case "filechange":
        setFiles(event.payload.files);
        setLineCounts(event.payload.lineCounts);
        return;
      case "result":
        setResult(event.payload);
        break;
      default:
        break;
    }

    const entry = toTimelineEntry(event);
    if (entry === null) return;
    setTimeline((current) => [...current, entry].slice(-MAX_TIMELINE));
  }, []);

  const refresh = useCallback(async () => {
    const api = window.nexcode;
    if (api === undefined) return;

    const [snapshot, engineStatus] = await Promise.all([api.listTasks(), api.engineStatus()]);
    setQueue(snapshot);
    setConnected(true);

    // Aktif görev yoksa en son görevin geçmişi replay edilir.
    const active = engineStatus.activeIds[0];
    const fallback = snapshot.done[0]?.id ?? snapshot.failed[0]?.id ?? snapshot.pending[0]?.id;
    const target = active ?? fallback;
    if (target === undefined) return;

    setTaskId(target);
    for (const event of await api.taskEvents(target)) apply(event);
  }, [apply]);

  useEffect(() => {
    const api = window.nexcode;
    if (api === undefined) return;

    // Canlı akışa ÖNCE abone olunur; replay sırasında gelen olaylar kaybolmaz, `seq`
    // tekilleştirmesi çakışmayı çözer.
    const unsubscribe = api.onEngineEvent(apply);
    void refresh();
    return unsubscribe;
  }, [apply, refresh]);

  return { status, queue, timeline, files, lineCounts, result, taskId, connected, refresh };
}

function toTimelineEntry(event: EngineEvent): TimelineEntry | null {
  const base = { seq: event.seq, ts: event.ts };

  if (event.type === "activity") {
    const payload: ActivityEvent = event.payload;
    // Ham stdout/stderr parçaları zaman çizelgesini boğar; terminal görünümüne aittir.
    if (payload.phase === "stdout" || payload.phase === "stderr") return null;

    return {
      ...base,
      kind: "activity",
      title: `${payload.agentName} ${phaseLabel(payload.phase)}`,
      detail: payload.durationMs === undefined ? "" : `${formatDuration(payload.durationMs)} sürdü`,
      agentId: payload.agentId,
      ...(payload.adapter !== undefined ? { adapter: payload.adapter } : {}),
      tone: payload.phase === "finished" ? "good" : payload.phase === "started" ? "neutral" : "warn",
    };
  }

  if (event.type === "message") {
    const payload: MessageEvent = event.payload;
    return {
      ...base,
      kind: "message",
      title: `${payload.from} -> ${payload.to}`,
      detail: payload.summary,
      tone: payload.kind === "failure" ? "bad" : payload.kind === "blocked" ? "warn" : "neutral",
    };
  }

  if (event.type === "log") {
    const payload: LogEvent = event.payload;
    return {
      ...base,
      kind: "log",
      title: payload.message,
      detail: payload.detail ?? "",
      tone: payload.level === "error" ? "bad" : payload.level === "warn" ? "warn" : "neutral",
    };
  }

  if (event.type === "result") {
    const payload: ResultEvent = event.payload;
    return {
      ...base,
      kind: "result",
      title: payload.outcome === "done" ? "Görev tamamlandı" : "Görev sonlandı",
      detail: payload.final,
      tone: payload.outcome === "done" ? "good" : payload.outcome === "blocked" ? "warn" : "bad",
    };
  }

  return null;
}

function phaseLabel(phase: ActivityEvent["phase"]): string {
  const labels: Record<ActivityEvent["phase"], string> = {
    started: "çalışmaya başladı",
    progress: "ilerliyor",
    stdout: "çıktı üretti",
    stderr: "uyarı üretti",
    timeout: "süre aşımına uğradı",
    stalled: "uzun süredir sessiz",
    finished: "işini bitirdi",
  };
  return labels[phase];
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} sn`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)} dk ${String(Math.round(seconds % 60))} sn`;
}

/** Ekip Akışı ve Komuta Merkezi üstündeki KPI şeridi. */
export function useKpis(state: EngineViewState) {
  return useMemo(() => {
    const delegations = state.timeline.filter((e) => e.kind === "message").length;
    const agents = new Set(state.timeline.filter((e) => e.agentId !== undefined).map((e) => e.agentId));
    return {
      rounds: state.status?.round ?? 0,
      delegations: state.status?.delegations ?? delegations,
      activeAgents: state.status?.activeTaskIds.length ?? 0,
      knownAgents: agents.size,
      changedFiles: state.files.length,
      calls: state.status?.callsToday ?? 0,
      budget: state.status?.dailyCallBudget ?? 0,
      added: state.lineCounts.added,
      removed: state.lineCounts.removed,
    };
  }, [state]);
}

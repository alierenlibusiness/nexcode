import type { AssignmentKind, CliAdapter, ExecutionMode, OrchestrationRole } from "../config/schema";

/**
 * The engine event contract: the four visual surfaces (Command Center, Board, Live Code,
 * Team Flow) and the persistent event history depend on these types.
 *
 * Contract rules:
 * - Event names and payload fields change additively; existing fields are never removed.
 * - Every event carries a `seq`; live events arriving during replay are de-duplicated by it.
 * - Sensitive content (`.env`, credentials, private keys) never enters a payload.
 */

export type EngineEventType =
  | "status"
  | "queue"
  | "activity"
  | "message"
  | "log"
  | "result"
  | "filechange"
  | "schedules";

/** Overall state of the engine. */
export interface EngineStatus {
  running: boolean;
  /**
   * Id of the running task; null when idle. Under concurrent execution this is the first
   * entry of `activeTaskIds` and stays singular for single-task interfaces.
   */
  currentTaskId: string | null;
  currentAgentId: string | null;
  round: number;
  maxRounds: number;
  delegations: number;
  callsToday: number;
  dailyCallBudget: number;
  approvalMode: "auto" | "ask";
  /** Every task running at once (single element or empty in a single-task setup). */
  activeTaskIds: string[];
  /** Effective slot count coming from the configuration. */
  concurrency: number;
}

export interface QueueSnapshot {
  pending: TaskSummary[];
  approval: TaskSummary[];
  done: TaskSummary[];
  failed: TaskSummary[];
}

export interface TaskSummary {
  id: string;
  prompt: string;
  executionMode: ExecutionMode;
  workingDir: string;
  createdAt: string;
  scheduleId: string | null;
  /** Number of files changed by the task (used by "View code" on the Board card). */
  changedFiles: number;
}

/** Lifecycle of a CLI or API process: the terminal cards and the team map consume this. */
export interface ActivityEvent {
  assignmentId: string;
  agentId: string;
  agentName: string;
  adapter: CliAdapter | undefined;
  phase: "started" | "progress" | "stdout" | "stderr" | "timeout" | "stalled" | "finished";
  /** Short live output fragment (for the raw terminal view). */
  chunk?: string;
  exitCode?: number;
  durationMs?: number;
}

/** Operator to specialist data flow: the lines in the Team Flow scene come from this event. */
export interface MessageEvent {
  assignmentId: string;
  kind: "delegation" | "result" | "failure" | "blocked";
  from: string;
  to: string;
  assignmentKind: AssignmentKind;
  role: OrchestrationRole;
  summary: string;
  round: number;
}

export interface LogEvent {
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

/** The final delivery of a task. */
export interface ResultEvent {
  taskId: string;
  outcome: "done" | "failed" | "blocked";
  final: string;
  verification: string;
  remainingRisk: string;
  rounds: number;
  delegations: number;
  calls: number;
  usdCost: number;
  files: FileChangeSummary[];
}

export type FileAction = "created" | "modified" | "deleted";

/** State of a file relative to the start of the task. */
export interface FileChangeSummary {
  path: string;
  action: FileAction;
  added: number;
  removed: number;
  /** Whether the content can be shown, and why not when it cannot. */
  previewStatus: "ok" | "binary" | "too-large" | "redacted" | "unreadable";
  hunks: DiffHunk[];
}

/** A git-like change block. */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  kind: "context" | "added" | "removed";
  oldLineNo: number | null;
  newLineNo: number | null;
  text: string;
}

export interface FileChangeEvent {
  taskId: string;
  counts: Record<FileAction, number>;
  lineCounts: { added: number; removed: number };
  files: FileChangeSummary[];
}

export interface ScheduleSummary {
  id: string;
  prompt: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  triggerLabel: string;
}

/** Discriminated union: consumers narrow on `type`. */
export type EngineEvent =
  | { type: "status"; seq: number; ts: string; taskId: string | null; payload: EngineStatus }
  | { type: "queue"; seq: number; ts: string; taskId: null; payload: QueueSnapshot }
  | { type: "activity"; seq: number; ts: string; taskId: string; payload: ActivityEvent }
  | { type: "message"; seq: number; ts: string; taskId: string; payload: MessageEvent }
  | { type: "log"; seq: number; ts: string; taskId: string | null; payload: LogEvent }
  | { type: "result"; seq: number; ts: string; taskId: string; payload: ResultEvent }
  | { type: "filechange"; seq: number; ts: string; taskId: string; payload: FileChangeEvent }
  | { type: "schedules"; seq: number; ts: string; taskId: null; payload: ScheduleSummary[] };

export type EngineEventListener = (event: EngineEvent) => void;

/**
 * A dependency free event emitter. It produces a monotonically increasing `seq`; the
 * persistent history and the live stream share the same number, so live events arriving
 * during the replay on page load can be de-duplicated.
 */
export class EngineEventBus {
  private listeners = new Set<EngineEventListener>();
  private seq: number;

  constructor(startSeq = 0) {
    this.seq = startSeq;
  }

  /** The last sequence number produced: lets the history continue across a restart. */
  get lastSeq(): number {
    return this.seq;
  }

  subscribe(listener: EngineEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit<T extends EngineEvent["type"]>(
    type: T,
    taskId: Extract<EngineEvent, { type: T }>["taskId"],
    payload: Extract<EngineEvent, { type: T }>["payload"],
    now: () => Date = () => new Date(),
  ): EngineEvent {
    const event = {
      type,
      seq: ++this.seq,
      ts: now().toISOString(),
      taskId,
      payload,
    } as EngineEvent;
    for (const listener of this.listeners) listener(event);
    return event;
  }
}

/**
 * Merges the persistent history with the live stream: events already present in the history
 * are skipped and the rest are applied in sequence order. This is the replay contract used
 * on page load.
 */
export function mergeReplay(history: readonly EngineEvent[], buffered: readonly EngineEvent[]): EngineEvent[] {
  const seen = new Set(history.map((event) => event.seq));
  const extra = buffered.filter((event) => !seen.has(event.seq));
  return [...history, ...extra].sort((a, b) => a.seq - b.seq);
}

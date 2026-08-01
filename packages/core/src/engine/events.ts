import type { AssignmentKind, CliAdapter, ExecutionMode, OrchestrationRole } from "../config/schema";

/**
 * Motor olay sözleşmesi: dört görsel yüzey (Komuta Merkezi, Pano, Canlı Kod, Ekip Akışı)
 * ve kalıcı olay geçmişi bu tiplere bağlıdır.
 *
 * Sözleşme kuralları:
 * - Olay adları ve payload alanları eklemeli (additive) değişir; mevcut alanlar kaldırılmaz.
 * - Her olay `seq` taşır; replay sırasında gelen canlı olaylar bu numarayla tekilleştirilir.
 * - Hassas içerik (`.env`, credential, özel anahtar) hiçbir payload'a girmez.
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

/** Motorun genel durumu. */
export interface EngineStatus {
  running: boolean;
  /**
   * Çalışan görevin id'si; boştaysa null. Eşzamanlı yürütmede bu, `activeTaskIds`
   * listesinin ilkidir ve tek görevli arayüzler için tekil kalır.
   */
  currentTaskId: string | null;
  currentAgentId: string | null;
  round: number;
  maxRounds: number;
  delegations: number;
  callsToday: number;
  dailyCallBudget: number;
  approvalMode: "auto" | "ask";
  /** Aynı anda koşan tüm görevler (tek görevli kurulumda tek elemanlı ya da boş). */
  activeTaskIds: string[];
  /** Yapılandırmadan gelen etkin slot sayısı. */
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
  /** Görev sonucunda değişen dosya sayısı (Pano kartında "Kodu gör" için). */
  changedFiles: number;
}

/** Bir CLI/API sürecinin yaşam döngüsü: terminal kartları ve ekip haritası bunu tüketir. */
export interface ActivityEvent {
  assignmentId: string;
  agentId: string;
  agentName: string;
  adapter: CliAdapter | undefined;
  phase: "started" | "progress" | "stdout" | "stderr" | "timeout" | "stalled" | "finished";
  /** Kısa canlı çıktı parçası (ham terminal görünümü için). */
  chunk?: string;
  exitCode?: number;
  durationMs?: number;
}

/** Operatör ↔ uzman veri akışı: Ekip Akışı sahnesindeki hatlar bu olaydan doğar. */
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

/** Görevin nihai teslimatı. */
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

/** Bir dosyanın görev başlangıcına göre durumu. */
export interface FileChangeSummary {
  path: string;
  action: FileAction;
  added: number;
  removed: number;
  /** İçerik gösterilebiliyor mu; gösterilemiyorsa nedeni. */
  previewStatus: "ok" | "binary" | "too-large" | "redacted" | "unreadable";
  hunks: DiffHunk[];
}

/** Git benzeri değişiklik bloğu. */
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

/** Ayrık birleşim: tüketiciler `type` üzerinden daraltır. */
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
 * Bağımlılıksız olay yayıcı. Monoton artan `seq` üretir; kalıcı geçmiş ve canlı akış
 * aynı numarayı paylaşır, böylece sayfa açılışındaki replay sırasında gelen canlı olaylar
 * tekilleştirilebilir.
 */
export class EngineEventBus {
  private listeners = new Set<EngineEventListener>();
  private seq: number;

  constructor(startSeq = 0) {
    this.seq = startSeq;
  }

  /** Son üretilen sıra numarası: yeniden başlatmada geçmişin devamı için. */
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
 * Kalıcı geçmiş ile canlı akışı birleştirir: geçmişte zaten bulunan olaylar atlanır,
 * kalanlar sıra numarasına göre uygulanır. Sayfa açılışındaki replay sözleşmesidir.
 */
export function mergeReplay(history: readonly EngineEvent[], buffered: readonly EngineEvent[]): EngineEvent[] {
  const seen = new Set(history.map((event) => event.seq));
  const extra = buffered.filter((event) => !seen.has(event.seq));
  return [...history, ...extra].sort((a, b) => a.seq - b.seq);
}

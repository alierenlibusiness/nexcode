import { randomUUID } from "node:crypto";
import type { DB } from "./connection";
import type { Task, TaskKind, TaskStatus } from "../domain/task";
import { titleFromPrompt } from "../domain/task";
import type { ExecutionMode } from "../config/schema";
import type { EngineEvent, QueueSnapshot, TaskSummary } from "../engine/events";
import type { NormalizedAssignment } from "../engine/routing";
import type { ReviewVerdict } from "../engine/verdict";

/**
 * Motorun kalıcı deposu: görev kuyruğu, tur/atama kaydı, olay geçmişi, operatör sohbeti
 * ve motor sayaçları.
 *
 * Olay geçmişi ile canlı akış **aynı** `seq` numarasını paylaşır; sayfa açılışındaki replay
 * bu sayede tamponlanan canlı olayları tekilleştirebilir.
 */

interface TaskRow {
  id: string;
  prompt: string;
  title: string;
  status: string;
  execution_mode: string;
  working_dir: string;
  kind: string;
  parent_task_id: string | null;
  schedule_id: string | null;
  plan_hash: string | null;
  priority: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  delivery: string;
  verification: string;
  remaining_risk: string;
  rounds: number;
  delegations: number;
  calls: number;
  usd_cost: number;
  changed_files: number;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    prompt: row.prompt,
    title: row.title,
    status: row.status as TaskStatus,
    executionMode: row.execution_mode as ExecutionMode,
    workingDir: row.working_dir,
    kind: row.kind as TaskKind,
    parentTaskId: row.parent_task_id,
    scheduleId: row.schedule_id,
    planHash: row.plan_hash,
    priority: row.priority,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    delivery: row.delivery,
    verification: row.verification,
    remainingRisk: row.remaining_risk,
    rounds: row.rounds,
    delegations: row.delegations,
    calls: row.calls,
    usdCost: row.usd_cost,
    changedFiles: row.changed_files,
  };
}

function toSummary(task: Task): TaskSummary {
  return {
    id: task.id,
    prompt: task.title,
    executionMode: task.executionMode,
    workingDir: task.workingDir,
    createdAt: task.createdAt,
    scheduleId: task.scheduleId,
    changedFiles: task.changedFiles,
  };
}

export interface CreateTaskInput {
  prompt: string;
  workingDir: string;
  executionMode?: ExecutionMode;
  kind?: TaskKind;
  parentTaskId?: string | null;
  scheduleId?: string | null;
  priority?: number;
}

export interface TaskCompletion {
  status: Extract<TaskStatus, "done" | "failed" | "blocked">;
  delivery: string;
  verification: string;
  remainingRisk: string;
  rounds: number;
  delegations: number;
  calls: number;
  usdCost: number;
  changedFiles: number;
}

export interface ConversationEntry {
  id: string;
  role: "user" | "operator";
  content: string;
  createdAt: string;
}

export interface AssignmentRecordRow {
  id: string;
  round: number;
  agentId: string;
  agentName: string;
  adapter: string | null;
  kind: string;
  role: string;
  instruction: string;
  dependsOn: string[];
  skills: string[];
  status: string;
  verdict: ReviewVerdict | null;
  output: string;
  durationMs: number;
}

export class EngineRepository {
  constructor(private readonly db: DB) {}

  // ── Görevler ──────────────────────────────────────────────────────────────

  create(input: CreateTaskInput): Task {
    const task: Task = {
      id: randomUUID(),
      prompt: input.prompt,
      title: titleFromPrompt(input.prompt),
      status: "pending",
      executionMode: input.executionMode ?? "auto",
      workingDir: input.workingDir,
      kind: input.kind ?? "task",
      parentTaskId: input.parentTaskId ?? null,
      scheduleId: input.scheduleId ?? null,
      planHash: null,
      priority: input.priority ?? 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      delivery: "",
      verification: "",
      remainingRisk: "",
      rounds: 0,
      delegations: 0,
      calls: 0,
      usdCost: 0,
      changedFiles: 0,
    };

    this.db
      .prepare(
        `INSERT INTO tasks
           (id, prompt, title, status, execution_mode, working_dir, kind, parent_task_id,
            schedule_id, plan_hash, priority, created_at, started_at, completed_at,
            delivery, verification, remaining_risk, rounds, delegations, calls, usd_cost, changed_files)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', 0, 0, 0, 0, 0)`,
      )
      .run(
        task.id,
        task.prompt,
        task.title,
        task.status,
        task.executionMode,
        task.workingDir,
        task.kind,
        task.parentTaskId,
        task.scheduleId,
        task.planHash,
        task.priority,
        task.createdAt,
        task.startedAt,
        task.completedAt,
      );
    return task;
  }

  getById(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row === undefined ? null : toTask(row);
  }

  listByStatus(status: TaskStatus): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE status = ? AND kind = 'task' ORDER BY priority DESC, created_at ASC")
      .all(status) as TaskRow[];
    return rows.map(toTask);
  }

  listAll(): Task[] {
    return (this.db.prepare("SELECT * FROM tasks ORDER BY created_at ASC").all() as TaskRow[]).map(toTask);
  }

  /**
   * Kuyruktan çalıştırılacak sıradaki görev (öncelik, sonra yaş).
   *
   * `skipIds` halihazırda bir slotta koşan görevlerdir; eşzamanlı yürütmede aynı görevin
   * iki slota düşmesini bu parametre engeller.
   */
  claimNext(skipIds: readonly string[] = []): Task | null {
    const placeholders = skipIds.map(() => "?").join(", ");
    const exclusion = skipIds.length === 0 ? "" : ` AND id NOT IN (${placeholders})`;
    const row = this.db
      .prepare(
        `SELECT * FROM tasks WHERE status = 'pending' AND kind = 'task'${exclusion}
         ORDER BY priority DESC, created_at ASC LIMIT 1`,
      )
      .get(...skipIds) as TaskRow | undefined;
    return row === undefined ? null : toTask(row);
  }

  markRunning(id: string): void {
    this.db
      .prepare("UPDATE tasks SET status = 'running', started_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  markAwaitingApproval(id: string, planHash: string): void {
    this.db.prepare("UPDATE tasks SET status = 'approval', plan_hash = ? WHERE id = ?").run(planHash, id);
  }

  complete(id: string, completion: TaskCompletion): void {
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, completed_at = ?, delivery = ?, verification = ?, remaining_risk = ?,
           rounds = ?, delegations = ?, calls = ?, usd_cost = ?, changed_files = ?
         WHERE id = ?`,
      )
      .run(
        completion.status,
        new Date().toISOString(),
        completion.delivery,
        completion.verification,
        completion.remainingRisk,
        completion.rounds,
        completion.delegations,
        completion.calls,
        completion.usdCost,
        completion.changedFiles,
        id,
      );
  }

  /** Yalnızca bekleyen görev düzenlenebilir; hedef değişince eski plan geçersizleşir. */
  updatePending(id: string, input: { prompt?: string; executionMode?: ExecutionMode; workingDir?: string }): boolean {
    const task = this.getById(id);
    if (task === null || task.status !== "pending") return false;

    const prompt = input.prompt ?? task.prompt;
    this.db
      .prepare("UPDATE tasks SET prompt = ?, title = ?, execution_mode = ?, working_dir = ?, plan_hash = NULL WHERE id = ?")
      .run(prompt, titleFromPrompt(prompt), input.executionMode ?? task.executionMode, input.workingDir ?? task.workingDir, id);

    if (input.prompt !== undefined && input.prompt !== task.prompt) {
      // Hedef değişti: önceki tur/atama kaydı artık geçerli değil.
      this.db.prepare("DELETE FROM task_rounds WHERE task_id = ?").run(id);
      this.db.prepare("DELETE FROM task_assignments WHERE task_id = ?").run(id);
    }
    return true;
  }

  /** Aktif görev silinemez. */
  remove(id: string): boolean {
    const task = this.getById(id);
    if (task === null || task.status === "running") return false;
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return true;
  }

  queueSnapshot(): QueueSnapshot {
    return {
      pending: this.listByStatus("pending").map(toSummary),
      approval: this.listByStatus("approval").map(toSummary),
      done: this.listByStatus("done").map(toSummary),
      failed: [...this.listByStatus("failed"), ...this.listByStatus("blocked")].map(toSummary),
    };
  }

  /** Sayfa açılışında replay edilecek görev: aktif, yoksa en son tamamlanan/başarısız. */
  replayTarget(): Task | null {
    const row = this.db
      .prepare(
        `SELECT * FROM tasks WHERE kind = 'task'
         ORDER BY (status = 'running') DESC, COALESCE(completed_at, created_at) DESC LIMIT 1`,
      )
      .get() as TaskRow | undefined;
    return row === undefined ? null : toTask(row);
  }

  // ── Olay geçmişi ──────────────────────────────────────────────────────────

  appendEvent(event: EngineEvent): void {
    this.db
      .prepare("INSERT OR REPLACE INTO task_events (seq, task_id, type, payload, ts) VALUES (?, ?, ?, ?, ?)")
      .run(event.seq, event.taskId, event.type, JSON.stringify(event.payload), event.ts);
  }

  /** Bir görevin kayıtlı olayları (replay kaynağı). */
  eventsFor(taskId: string, limit = 1500): EngineEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY seq ASC LIMIT ?")
      .all(taskId, limit) as Array<{ seq: number; task_id: string | null; type: string; payload: string; ts: string }>;
    return rows.map(
      (row) =>
        ({
          seq: row.seq,
          taskId: row.task_id,
          type: row.type,
          payload: JSON.parse(row.payload) as unknown,
          ts: row.ts,
        }) as EngineEvent,
    );
  }

  /** Yeniden başlatmada olay numaralandırması geçmişin devamından sürer. */
  lastEventSeq(): number {
    const row = this.db.prepare("SELECT MAX(seq) AS seq FROM task_events").get() as { seq: number | null };
    return row.seq ?? 0;
  }

  // ── Tur ve atama kaydı ────────────────────────────────────────────────────

  startRound(taskId: string, round: number, phase: string, planSummary: string): void {
    this.db
      .prepare(
        `INSERT INTO task_rounds (task_id, round, phase, plan_summary, started_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(task_id, round) DO UPDATE SET phase = excluded.phase, plan_summary = excluded.plan_summary`,
      )
      .run(taskId, round, phase, planSummary, new Date().toISOString());
  }

  endRound(taskId: string, round: number): void {
    this.db
      .prepare("UPDATE task_rounds SET ended_at = ? WHERE task_id = ? AND round = ?")
      .run(new Date().toISOString(), taskId, round);
  }

  recordAssignment(
    taskId: string,
    round: number,
    assignment: NormalizedAssignment,
    result: { status: "completed" | "failed"; output: string; verdict: ReviewVerdict | null; durationMs: number },
  ): void {
    this.db
      .prepare(
        `INSERT INTO task_assignments
           (id, task_id, round, agent_id, agent_name, adapter, kind, role, instruction,
            depends_on, skills, status, verdict, output, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id, id) DO UPDATE SET
           status = excluded.status, verdict = excluded.verdict,
           output = excluded.output, duration_ms = excluded.duration_ms`,
      )
      .run(
        assignment.id,
        taskId,
        round,
        assignment.agentId,
        assignment.agentName,
        assignment.adapter ?? null,
        assignment.kind,
        assignment.role,
        assignment.instruction,
        JSON.stringify(assignment.dependsOn),
        JSON.stringify(assignment.skills),
        result.status,
        result.verdict,
        result.output,
        result.durationMs,
      );
  }

  assignmentsFor(taskId: string): AssignmentRecordRow[] {
    const rows = this.db
      .prepare("SELECT * FROM task_assignments WHERE task_id = ? ORDER BY round ASC, rowid ASC")
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      round: Number(row.round),
      agentId: String(row.agent_id),
      agentName: String(row.agent_name),
      adapter: row.adapter === null ? null : String(row.adapter),
      kind: String(row.kind),
      role: String(row.role),
      instruction: String(row.instruction),
      dependsOn: JSON.parse(String(row.depends_on)) as string[],
      skills: JSON.parse(String(row.skills)) as string[],
      status: String(row.status),
      verdict: row.verdict === null ? null : (String(row.verdict) as ReviewVerdict),
      output: String(row.output),
      durationMs: Number(row.duration_ms),
    }));
  }

  // ── Operatör sohbeti ──────────────────────────────────────────────────────

  appendConversation(taskId: string, role: ConversationEntry["role"], content: string): ConversationEntry {
    const entry: ConversationEntry = {
      id: randomUUID(),
      role,
      content,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO task_conversation (id, task_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(entry.id, taskId, entry.role, entry.content, entry.createdAt);
    return entry;
  }

  conversationFor(taskId: string): ConversationEntry[] {
    const rows = this.db
      .prepare("SELECT id, role, content, created_at FROM task_conversation WHERE task_id = ? ORDER BY created_at ASC")
      .all(taskId) as Array<{ id: string; role: string; content: string; created_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      role: row.role as ConversationEntry["role"],
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  // ── Motor durumu ──────────────────────────────────────────────────────────

  getState(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM engine_state WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setState(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO engine_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  /** Bugünkü toplam model çağrısı: günlük bütçe kontrolü için. */
  callsToday(today = new Date().toISOString().slice(0, 10)): number {
    const stored = this.getState("callsDate");
    if (stored !== today) return 0;
    return Number(this.getState("callsToday") ?? "0");
  }

  setCallsToday(calls: number, today = new Date().toISOString().slice(0, 10)): void {
    this.setState("callsDate", today);
    this.setState("callsToday", String(calls));
  }
}

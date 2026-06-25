import { randomUUID } from "node:crypto";
import type { DB } from "./connection";
import type { Task, TaskStatus } from "../domain/task";
import type { AgentRole } from "../domain/agent";

export interface CreateTaskInput {
  title: string;
  assignedRole?: AgentRole | null;
  agentId?: string | null;
  priority?: number;
}

interface TaskRow {
  id: string;
  agent_id: string | null;
  assigned_role: string | null;
  title: string;
  status: string;
  priority: number;
  created_at: string;
  completed_at: string | null;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    agentId: row.agent_id,
    assignedRole: (row.assigned_role as AgentRole | null) ?? null,
    title: row.title,
    status: row.status as TaskStatus,
    priority: row.priority,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/** Görev CRUD + durum geçişleri — yerel SQLite (PRD §14). */
export class TaskRepository {
  constructor(private readonly db: DB) {}

  create(input: CreateTaskInput): Task {
    const task: Task = {
      id: randomUUID(),
      agentId: input.agentId ?? null,
      assignedRole: input.assignedRole ?? null,
      title: input.title,
      status: "backlog",
      priority: input.priority ?? 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    this.db
      .prepare(
        "INSERT INTO tasks (id, agent_id, assigned_role, title, status, priority, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        task.id,
        task.agentId,
        task.assignedRole,
        task.title,
        task.status,
        task.priority,
        task.createdAt,
        task.completedAt,
      );
    return task;
  }

  updateStatus(id: string, status: TaskStatus): void {
    const completedAt = status === "done" ? new Date().toISOString() : null;
    this.db
      .prepare("UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?")
      .run(status, completedAt, id);
  }

  getById(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | TaskRow
      | undefined;
    return row ? toTask(row) : null;
  }

  listByStatus(status: TaskStatus): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at ASC")
      .all(status) as TaskRow[];
    return rows.map(toTask);
  }

  listAll(): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks ORDER BY created_at ASC")
      .all() as TaskRow[];
    return rows.map(toTask);
  }
}

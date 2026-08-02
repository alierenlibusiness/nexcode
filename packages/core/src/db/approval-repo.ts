import { randomUUID } from "node:crypto";
import type { DB } from "./connection";
import type { ApprovalStatus } from "../domain/task";

export interface ApprovalRecord {
  id: string;
  taskId: string;
  actionType: string;
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

interface ApprovalRow {
  id: string;
  task_id: string;
  action_type: string;
  status: string;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

function toRecord(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    actionType: row.action_type,
    status: row.status as ApprovalStatus,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

/** Manages approval requests in SQLite. */
export class ApprovalRepository {
  constructor(private readonly db: DB) {}

  create(taskId: string, actionType: string): ApprovalRecord {
    const record: ApprovalRecord = {
      id: randomUUID(),
      taskId,
      actionType,
      status: "pending",
      requestedAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
    };
    this.db
      .prepare(
        "INSERT INTO approvals (id, task_id, action_type, status, requested_at, resolved_at, resolved_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(record.id, record.taskId, record.actionType, record.status, record.requestedAt, null, null);
    return record;
  }

  resolve(id: string, status: "approved" | "rejected", resolvedBy: string): void {
    this.db
      .prepare("UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?")
      .run(status, new Date().toISOString(), resolvedBy, id);
  }

  listPending(): ApprovalRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY requested_at ASC")
      .all() as ApprovalRow[];
    return rows.map(toRecord);
  }

  getById(id: string): ApprovalRecord | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as
      | ApprovalRow
      | undefined;
    return row ? toRecord(row) : null;
  }
}

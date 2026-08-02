import type { ExecutionMode } from "../config/schema";

/**
 * Task status: the Kanban board columns and the engine lifecycle use the same vocabulary.
 *
 * `approval` only occurs with `approvalMode: "ask"` and a risky plan; there is no separate
 * column on the board, and a task awaiting approval shows up on the approval card in the
 * Command Center.
 */
export type TaskStatus = "pending" | "approval" | "running" | "done" | "failed" | "blocked";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "pending",
  "approval",
  "running",
  "done",
  "failed",
  "blocked",
];

/** Task kind: an ordinary task, or a read-only conversation about a completed task. */
export type TaskKind = "task" | "operator-chat";

/** The task data model. */
export interface Task {
  id: string;
  /** The goal text the user wrote. */
  prompt: string;
  /** Short title shown in lists (the first line of the prompt). */
  title: string;
  status: TaskStatus;
  executionMode: ExecutionMode;
  workingDir: string;
  kind: TaskKind;
  /** Id of the main task, on `operator-chat` tasks. */
  parentTaskId: string | null;
  /** The schedule that produced the task, if any: the "scheduled" badge on the Board. */
  scheduleId: string | null;
  /** Hash of the plan in the approval queue; if the plan changes, the approval is invalidated. */
  planHash: string | null;
  priority: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Delivery summary and its evidence. */
  delivery: string;
  verification: string;
  remainingRisk: string;
  rounds: number;
  delegations: number;
  calls: number;
  usdCost: number;
  changedFiles: number;
}

/** Action kinds that are destructive or otherwise require approval. */
export type ApprovalActionType =
  | "risky_plan"
  | "git_push"
  | "branch_delete"
  | "file_delete"
  | "production_deploy"
  | "env_change"
  | "irreversible_migration"
  | "dependency_remove";

export type ApprovalStatus = "pending" | "approved" | "rejected";

/** Derives the short title shown in lists from the prompt. */
export function titleFromPrompt(prompt: string, maxLength = 80): string {
  const firstLine = prompt.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? "(empty task)";
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 1)}…` : firstLine;
}

/** Task board kolonları / görev durumu (PRD §11 Kanban). */
export type TaskStatus = "backlog" | "in_progress" | "review" | "blocked" | "done";

/** Görev veri modeli (PRD §14). */
export interface Task {
  id: string;
  agentId: string | null;
  title: string;
  status: TaskStatus;
  priority: number;
  createdAt: string;
  completedAt: string | null;
}

/** Yıkıcı/onay gerektiren eylem türleri (PRD §6.8, §12). */
export type ApprovalActionType =
  | "git_push"
  | "branch_delete"
  | "file_delete"
  | "production_deploy"
  | "env_change"
  | "irreversible_migration"
  | "dependency_remove";

export type ApprovalStatus = "pending" | "approved" | "rejected";

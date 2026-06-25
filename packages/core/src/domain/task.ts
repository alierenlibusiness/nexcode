import type { AgentRole } from "./agent";

/** Task board kolonları / görev durumu (PRD §11 Kanban). */
export type TaskStatus = "backlog" | "in_progress" | "review" | "blocked" | "done";

/** Görev veri modeli (PRD §14). */
export interface Task {
  id: string;
  /** Görevi yürüten somut agent kaydının id'si (Faz 1'de genelde null). */
  agentId: string | null;
  /** Görevin atandığı rol (CEO planlamasında belirlenir). */
  assignedRole: AgentRole | null;
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

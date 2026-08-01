import type { ExecutionMode } from "../config/schema";

/**
 * Görev durumu — Kanban panosunun sütunları ve motorun yaşam döngüsü aynı sözlüğü kullanır.
 *
 * `approval` yalnızca `approvalMode: "ask"` ve riskli plan durumunda oluşur; görsel panoda
 * ayrı sütun yoktur, onay bekleyen görev Komuta Merkezi'ndeki onay kartında görünür.
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

/** Görev türü — normal görev ya da tamamlanmış bir görev hakkındaki salt-okunur sohbet. */
export type TaskKind = "task" | "operator-chat";

/** Görev veri modeli (PRD §14). */
export interface Task {
  id: string;
  /** Kullanıcının yazdığı hedef metni. */
  prompt: string;
  /** Listelerde gösterilen kısa başlık (prompt'un ilk satırı). */
  title: string;
  status: TaskStatus;
  executionMode: ExecutionMode;
  workingDir: string;
  kind: TaskKind;
  /** `operator-chat` görevlerinde ana görevin id'si. */
  parentTaskId: string | null;
  /** Görevi üreten zamanlama (varsa) — Pano'da "⏱ zamanlanmış" rozeti. */
  scheduleId: string | null;
  /** Onay kuyruğundaki planın hash'i; plan değişirse onay geçersizleşir. */
  planHash: string | null;
  priority: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Teslimat özeti ve kanıtları. */
  delivery: string;
  verification: string;
  remainingRisk: string;
  rounds: number;
  delegations: number;
  calls: number;
  usdCost: number;
  changedFiles: number;
}

/** Yıkıcı/onay gerektiren eylem türleri (PRD §6.8, §12). */
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

/** Prompt'tan listelerde gösterilecek kısa başlığı türetir. */
export function titleFromPrompt(prompt: string, maxLength = 80): string {
  const firstLine = prompt.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? "(boş görev)";
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 1)}…` : firstLine;
}

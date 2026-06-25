import type { AutonomyLevel } from "../domain/agent";

/**
 * Onay kapısı (PRD §6.8, §12). Bir eylemin insan onayı gerektirip gerektirmediğini
 * belirler. "required" eylemler otonomi seviyesinden BAĞIMSIZ olarak daima onay
 * gerektirir (sıfır-tolerans, PRD §24).
 */
export type ApprovalDecision = "auto" | "optional" | "required";

/** Daima insan onayı gerektiren, geri alınamaz eylemler (PRD §6.8). */
export const ALWAYS_REQUIRED_ACTIONS: ReadonlySet<string> = new Set([
  "git_push",
  "git_push_force",
  "branch_delete",
  "file_delete",
  "production_deploy",
  "env_change",
  "irreversible_migration",
  "dependency_remove",
  "main_direct_push",
]);

/** Otonomi düşükse onay sorulan, aksi halde otomatik geçen eylemler. */
export const OPTIONAL_ACTIONS: ReadonlySet<string> = new Set([
  "file_create",
  "dependency_add",
]);

/** Bir eylem türünü sınıflandırır. Bilinmeyen/zararsız eylemler `auto` kabul edilir. */
export function classifyAction(actionType: string): ApprovalDecision {
  if (ALWAYS_REQUIRED_ACTIONS.has(actionType)) return "required";
  if (OPTIONAL_ACTIONS.has(actionType)) return "optional";
  return "auto";
}

/**
 * Eylemin insan onayı bekleyip beklemeyeceğini, otonomi seviyesini de hesaba katarak döner.
 * - `required` → her zaman true (otonomi ne olursa olsun)
 * - `optional` → yalnızca `manual` otonomide true
 * - `auto`     → her zaman false
 */
export function requiresHumanApproval(actionType: string, autonomy: AutonomyLevel): boolean {
  const decision = classifyAction(actionType);
  if (decision === "required") return true;
  if (decision === "optional") return autonomy === "manual";
  return false;
}

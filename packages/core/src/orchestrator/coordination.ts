import type { AgentRole } from "../domain/agent";
import type { AgentMessage } from "../agents/message-bus";

/** Bir görevin tamamlanması için takip mesajı planı (yayınlanmadan önce, saf). */
export type FollowUp = Pick<AgentMessage, "from" | "to" | "type" | "payload">;

export interface CompletedTaskContext {
  role: AgentRole;
  taskId: string;
  /** Üretilen/değişen dosyalar (varsa) — review/test payload'ına eklenir. */
  files?: readonly string[];
  diffId?: string;
  /** DevOps değişikliği güvenlik etkisi taşıyor mu (PRD §8.6). */
  securitySensitive?: boolean;
}

/**
 * Bir görev tamamlandığında otomatik tetiklenmesi gereken inter-agent mesajları (PRD
 * §8.2/§8.3/§8.5/§8.6). Saf fonksiyon — orchestrator bu listeyi MessageBus'a yayınlar.
 *
 * Kurallar:
 * - Backend tamamlandı → Security'ye review_request (PR otomatik review, §8.3).
 * - DevOps tamamlandı + güvenlik etkili → Security'ye review_request (§8.6).
 * - Kod üreten rol (frontend/backend) tamamlandı → QA'ya test_request (event-driven, §8.2/§8.5).
 * - Security ve QA kendileri yeni iş üretmez (tetiklemeli roller) → takip mesajı yok.
 */
export function followUpsForCompletion(ctx: CompletedTaskContext): FollowUp[] {
  const out: FollowUp[] = [];
  const files = ctx.files ?? [];
  const diffId = ctx.diffId ?? ctx.taskId;

  const needsSecurity =
    ctx.role === "backend" || (ctx.role === "devops" && ctx.securitySensitive === true);
  if (needsSecurity) {
    out.push({
      from: ctx.role,
      to: "security",
      type: "review_request",
      payload: { diffId, files, taskId: ctx.taskId },
    });
  }

  const producesCode = ctx.role === "frontend" || ctx.role === "backend";
  if (producesCode) {
    out.push({
      from: ctx.role,
      to: "qa",
      type: "test_request",
      payload: { taskId: ctx.taskId, files },
    });
  }

  return out;
}

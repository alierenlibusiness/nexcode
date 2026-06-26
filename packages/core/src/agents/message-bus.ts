import { randomUUID } from "node:crypto";
import type { AgentRole } from "../domain/agent";

/** Agent'lar arası mesaj tipleri (PRD §6.7). */
export type AgentMessageType =
  | "review_request" // Backend/DevOps → Security (PR/diff incelemesi)
  | "review_result" // Security → açan agent (onay/blok)
  | "test_request" // tamamlanan görev → QA (event-driven tetik)
  | "test_result" // QA → açan agent (geçti/başarısız)
  | "task_handoff" // agent → agent (bağımlılık devri)
  | "task_blocked"; // herhangi → CEO (yeniden planlama)

export interface ReviewRequestPayload {
  diffId: string;
  files: readonly string[];
  taskId: string;
}

export interface TestRequestPayload {
  taskId: string;
  files?: readonly string[];
}

/** Message bus zarfı (PRD §6.7 JSON şemasıyla birebir: from/to/type/payload). */
export interface AgentMessage<P = unknown> {
  id: string;
  from: AgentRole;
  to: AgentRole;
  type: AgentMessageType;
  payload: P;
  createdAt: string;
}

export type MessageHandler = (msg: AgentMessage) => void | Promise<void>;
export type Unsubscribe = () => void;

interface Subscription {
  to?: AgentRole;
  type?: AgentMessageType;
  handler: MessageHandler;
}

/**
 * In-process inter-agent message bus (PRD §6.7, §5.3 in-process varsayılan).
 * Alıcı role'e ve/veya mesaj tipine göre abonelik; `publish` eşleşen tüm
 * handler'lara (sırayla, await ederek) teslim eder. Dağıtık kuyruk yalnızca
 * opsiyonel bulut katmanında (BullMQ) — burada gerekli değil.
 */
export class MessageBus {
  private readonly subs = new Set<Subscription>();
  private readonly log: AgentMessage[] = [];

  /** Belirli bir role gelen mesajlara abone ol. */
  on(to: AgentRole, handler: MessageHandler): Unsubscribe {
    return this.subscribe({ to, handler });
  }

  /** Belirli bir tipteki tüm mesajlara abone ol (role'den bağımsız). */
  onType(type: AgentMessageType, handler: MessageHandler): Unsubscribe {
    return this.subscribe({ type, handler });
  }

  private subscribe(sub: Subscription): Unsubscribe {
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  /** Mesajı yayınlar; eşleşen handler'lara teslim eder ve geçmişe yazar. */
  async publish<P>(input: Omit<AgentMessage<P>, "id" | "createdAt">): Promise<AgentMessage<P>> {
    const message: AgentMessage<P> = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.log.push(message as AgentMessage);

    for (const sub of this.subs) {
      if (sub.to && sub.to !== message.to) continue;
      if (sub.type && sub.type !== message.type) continue;
      await sub.handler(message as AgentMessage);
    }
    return message;
  }

  /** Teslim edilmiş mesaj geçmişi (gözlemlenebilirlik/test). */
  history(): readonly AgentMessage[] {
    return this.log;
  }
}

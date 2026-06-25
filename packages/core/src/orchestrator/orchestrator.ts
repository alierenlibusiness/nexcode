import type { AgentRole, ModelRef } from "../domain/agent";
import type { Task } from "../domain/task";
import type { AIProviderAdapter } from "../providers/types";
import type { ConnectionPreference } from "../providers/connection";
import type { TaskRepository } from "../db/task-repo";
import { getAgentDefinition } from "../agents/definitions";
import { parsePlan, PLAN_INSTRUCTION } from "./plan";
import { logger } from "../logger";

export interface OrchestratorDeps {
  tasks: TaskRepository;
  /** ModelRef + tercih → adapter (AdapterFactory.resolve ile beslenir). */
  resolveAdapter: (model: ModelRef, preference: ConnectionPreference) => AIProviderAdapter;
  /** Bir rolün bağlantı tercihi (API/CLI) — kullanıcının seçimi. */
  getPreference: (role: AgentRole) => ConnectionPreference;
}

/**
 * Faz 1 orkestratörü: kullanıcı isteğini CEO ile plana çevirir, görevleri oluşturur;
 * onay sonrası görevi atanan agent'a dispatch eder. Her agent çağrısı, kullanıcının
 * seçtiği bağlantı moduna (API/CLI) göre çözümlenen adapter üzerinden yapılır.
 */
export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  private adapterFor(role: AgentRole): { adapter: AIProviderAdapter; model: ModelRef; systemPrompt: string } {
    const def = getAgentDefinition(role);
    if (!def) throw new Error(`Faz 1'de tanımlı olmayan rol: ${role}`);
    const adapter = this.deps.resolveAdapter(def.model, this.deps.getPreference(role));
    return { adapter, model: def.model, systemPrompt: def.systemPrompt };
  }

  /** Kullanıcı isteğini CEO ile plana çevirir ve görevleri (backlog) oluşturur. */
  async planRequest(userRequest: string): Promise<Task[]> {
    const { adapter, model, systemPrompt } = this.adapterFor("ceo");
    const completion = await adapter.complete({
      model: model.modelId,
      system: systemPrompt,
      messages: [{ role: "user", content: PLAN_INSTRUCTION + userRequest }],
    });

    const planned = parsePlan(completion.text);
    logger.info("orchestrator.plan", {
      taskCount: planned.length,
      connectionMode: adapter.connectionMode,
    });

    return planned.map((item) =>
      this.deps.tasks.create({ title: item.title, assignedRole: item.role }),
    );
  }

  /** Onaylanmış bir görevi atanan agent'a verir; üretilen çıktı metnini döner. */
  async dispatchTask(taskId: string): Promise<string> {
    const task = this.deps.tasks.getById(taskId);
    if (!task) throw new Error(`Görev bulunamadı: ${taskId}`);
    const role: AgentRole = task.assignedRole ?? "backend";

    this.deps.tasks.updateStatus(taskId, "in_progress");
    const { adapter, model, systemPrompt } = this.adapterFor(role);
    const completion = await adapter.complete({
      model: model.modelId,
      system: systemPrompt,
      messages: [{ role: "user", content: task.title }],
    });

    this.deps.tasks.updateStatus(taskId, "review");
    logger.info("orchestrator.dispatch", { taskId, role, connectionMode: adapter.connectionMode });
    return completion.text;
  }
}

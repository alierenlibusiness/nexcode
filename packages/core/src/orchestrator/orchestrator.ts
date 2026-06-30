import type { AgentRole, ConnectionMode, ModelRef } from "../domain/agent";
import type { Task } from "../domain/task";
import type { AIProviderAdapter, CompletionResult, TokenUsage, CompletionImage } from "../providers/types";
import type { ConnectionPreference } from "../providers/connection";
import type { TaskRepository } from "../db/task-repo";
import { getAgentDefinition } from "../agents/definitions";
import type { MessageBus } from "../agents/message-bus";
import { followUpsForCompletion, type CompletedTaskContext } from "./coordination";
import { parsePlan, PLAN_INSTRUCTION } from "./plan";
import { logger } from "../logger";
import type { McpManager } from "../mcp/manager";

/** Bir model çağrısının maliyet/kota emisyonu (cost_logs + QuotaTracker beslemesi, §9.4). */
export interface OrchestratorUsage {
  role: AgentRole;
  taskId: string | null;
  model: ModelRef;
  connectionMode: ConnectionMode;
  usage: TokenUsage;
  usdCost: number;
}

export interface OrchestratorDeps {
  tasks: TaskRepository;
  /** ModelRef + tercih → adapter (AdapterFactory.resolve ile beslenir). */
  resolveAdapter: (model: ModelRef, preference: ConnectionPreference) => AIProviderAdapter;
  /** Bir rolün bağlantı tercihi (API/CLI) — kullanıcının seçimi. */
  getPreference: (role: AgentRole) => ConnectionPreference;
  /** Bir rol için çözümlenecek ModelRef (kullanıcı model seçimi); yoksa agent varsayılanı. */
  resolveModel?: (role: AgentRole) => ModelRef;
  /** Inter-agent mesaj otobüsü (Faz 2) — review/test tetikleri için (PRD §6.7). */
  messageBus?: MessageBus;
  /** Her model çağrısından sonra maliyet/kota kaydı için (cost_logs + QuotaTracker). */
  onUsage?: (usage: OrchestratorUsage) => void;
  mcpManager?: McpManager;
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
    if (!def) throw new Error(`Tanımlı olmayan rol: ${role}`);
    // Kullanıcı model seçimi varsa onu kullan, yoksa agent varsayılanı (PRD §7/§9.5).
    const model = this.deps.resolveModel?.(role) ?? def.model;
    const adapter = this.deps.resolveAdapter(model, this.deps.getPreference(role));
    return { adapter, model, systemPrompt: def.systemPrompt };
  }

  /** Kullanıcı isteğini CEO ile plana çevirir ve görevleri (backlog) veya metin yanıtını oluşturur. */
  async planRequest(userRequest: string, images?: CompletionImage[]): Promise<{ tasks: Task[]; textResponse?: string }> {
    const { adapter, model, systemPrompt } = this.adapterFor("ceo");
    
    let promptWithMcp = PLAN_INSTRUCTION + userRequest;
    if (this.deps.mcpManager) {
      try {
        const tools = await this.deps.mcpManager.listAllTools();
        if (tools.length > 0) {
          promptWithMcp += "\n\nAvailable Model Context Protocol (MCP) Tools you can suggest using:\n";
          for (const tool of tools) {
            promptWithMcp += `- [${tool.serverName}] ${tool.name}: ${tool.description || "No description"} (Schema: ${JSON.stringify(tool.inputSchema)})\n`;
          }
        }
      } catch (e) {
        logger.warn("orchestrator.plan.mcp_failed", { error: String(e) });
      }
    }

    const req = {
      model: model.modelId,
      system: systemPrompt,
      messages: [{ role: "user" as const, content: promptWithMcp, images }],
    };
    const completion = await adapter.complete(req);
    this.emitUsage("ceo", null, model, adapter, req, completion);

    const planned = parsePlan(completion.text);
    if (planned === null) {
      logger.info("orchestrator.plan.conversational", {
        connectionMode: adapter.connectionMode,
      });
      return { tasks: [], textResponse: completion.text };
    }

    logger.info("orchestrator.plan", {
      taskCount: planned.length,
      connectionMode: adapter.connectionMode,
    });

    const tasks = planned.map((item) =>
      this.deps.tasks.create({ title: item.title, assignedRole: item.role }),
    );
    return { tasks };
  }

  /** Onaylanmış bir görevi atanan agent'a verir; üretilen çıktı metnini döner. */
  async dispatchTask(taskId: string): Promise<string> {
    const task = this.deps.tasks.getById(taskId);
    if (!task) throw new Error(`Görev bulunamadı: ${taskId}`);
    const role: AgentRole = task.assignedRole ?? "backend";

    this.deps.tasks.updateStatus(taskId, "in_progress");
    const { adapter, model, systemPrompt } = this.adapterFor(role);
    const req = {
      model: model.modelId,
      system: systemPrompt,
      messages: [{ role: "user" as const, content: task.title }],
    };
    const completion = await adapter.complete(req);
    this.emitUsage(role, taskId, model, adapter, req, completion);

    this.deps.tasks.updateStatus(taskId, "review");
    logger.info("orchestrator.dispatch", { taskId, role, connectionMode: adapter.connectionMode });

    await this.publishFollowUps({ role, taskId });
    return completion.text;
  }

  /** Maliyet/kota kaydı için usage emisyonu (cost_logs + QuotaTracker, §9.4). */
  private emitUsage(
    role: AgentRole,
    taskId: string | null,
    model: ModelRef,
    adapter: AIProviderAdapter,
    req: Parameters<AIProviderAdapter["complete"]>[0],
    completion: CompletionResult,
  ): void {
    if (!this.deps.onUsage) return;
    const usdCost = adapter.estimateCost(req, completion.usage).usd;
    this.deps.onUsage({
      role,
      taskId,
      model,
      connectionMode: adapter.connectionMode,
      usage: completion.usage,
      usdCost,
    });
  }

  /**
   * Bir görev tamamlandığında otomatik inter-agent tetikleri (Backend→Security review,
   * kod→QA test) yayınlar (PRD §8.2/§8.3/§8.5/§8.6). MessageBus yoksa sessizce atlar.
   */
  private async publishFollowUps(ctx: CompletedTaskContext): Promise<void> {
    const bus = this.deps.messageBus;
    if (!bus) return;
    for (const followUp of followUpsForCompletion(ctx)) {
      await bus.publish(followUp);
      logger.info("orchestrator.followup", { type: followUp.type, to: followUp.to, taskId: ctx.taskId });
    }
  }
}

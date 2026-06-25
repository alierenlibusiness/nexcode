import { ipcMain } from "electron";
import {
  IpcChannels,
  createWorkspaceInputSchema,
  requestPlanInputSchema,
  taskDispatchInputSchema,
  approvalResolveInputSchema,
  connectionSetInputSchema,
  secretSetApiKeyInputSchema,
  secretHasApiKeyInputSchema,
  FAZ1_AGENTS,
  logger,
  type ConnectionPreference,
  type AgentRole,
  type SecretStore,
} from "@nexcode/core";
import {
  WorkspaceRepository,
  TaskRepository,
  ApprovalRepository,
  AgentSettingsRepository,
} from "@nexcode/core/db";
import type { Orchestrator } from "@nexcode/core";

const KEYCHAIN_SERVICE = "nexcode";

export interface IpcContext {
  workspaces: WorkspaceRepository;
  tasks: TaskRepository;
  approvals: ApprovalRepository;
  settings: AgentSettingsRepository;
  orchestrator: Orchestrator;
  secretStore: SecretStore;
  apiKeyCache: Map<string, string>;
  workspaceId: string;
}

/**
 * Tüm IPC handler'larını kaydeder. Gelen payload'lar Zod ile doğrulanır (PRD §15).
 * Hatalar handler içinde fırlatılır; Electron bunları renderer'a reject olarak iletir.
 */
export function registerIpcHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.workspaceCreate, (_e, raw: unknown) => {
    const input = createWorkspaceInputSchema.parse(raw);
    const created = ctx.workspaces.create(input);
    logger.info("workspace.created", { id: created.id });
    return created;
  });

  ipcMain.handle(IpcChannels.workspaceList, () => ctx.workspaces.list());

  // İstek → CEO planı → görevler (PRD §8.1)
  ipcMain.handle(IpcChannels.requestPlan, async (_e, raw: unknown) => {
    const { request } = requestPlanInputSchema.parse(raw);
    return ctx.orchestrator.planRequest(request);
  });

  ipcMain.handle(IpcChannels.taskList, () => ctx.tasks.listAll());

  ipcMain.handle(IpcChannels.taskDispatch, async (_e, raw: unknown) => {
    const { taskId } = taskDispatchInputSchema.parse(raw);
    const output = await ctx.orchestrator.dispatchTask(taskId);
    return { output };
  });

  ipcMain.handle(IpcChannels.approvalListPending, () => ctx.approvals.listPending());

  ipcMain.handle(IpcChannels.approvalResolve, (_e, raw: unknown) => {
    const { id, status } = approvalResolveInputSchema.parse(raw);
    ctx.approvals.resolve(id, status, "user");
    logger.info("approval.resolved", { id, status });
  });

  // Bağlantı modu (API/CLI) — kullanıcının per-agent seçimi (PRD §9.5)
  ipcMain.handle(IpcChannels.connectionGetAll, () => {
    const result: Partial<Record<AgentRole, ConnectionPreference>> = {};
    for (const agent of FAZ1_AGENTS) {
      result[agent.role] = ctx.settings.getPreference(ctx.workspaceId, agent.role);
    }
    return result;
  });

  ipcMain.handle(IpcChannels.connectionSet, (_e, raw: unknown) => {
    const { role, preference } = connectionSetInputSchema.parse(raw);
    ctx.settings.setPreference(ctx.workspaceId, role, preference);
    logger.info("connection.set", { role, preference });
  });

  // Sır/anahtar — OS keychain (PRD §5.7, §12)
  ipcMain.handle(IpcChannels.secretSetApiKey, async (_e, raw: unknown) => {
    const { provider, apiKey } = secretSetApiKeyInputSchema.parse(raw);
    await ctx.secretStore.set(KEYCHAIN_SERVICE, provider, apiKey);
    ctx.apiKeyCache.set(provider, apiKey);
    logger.info("secret.api_key_set", { provider });
  });

  ipcMain.handle(IpcChannels.secretHasApiKey, async (_e, raw: unknown) => {
    const { provider } = secretHasApiKeyInputSchema.parse(raw);
    if (ctx.apiKeyCache.has(provider)) return true;
    const stored = await ctx.secretStore.get(KEYCHAIN_SERVICE, provider);
    return stored !== null;
  });
}

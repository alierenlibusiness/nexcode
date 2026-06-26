import { ipcMain, dialog, type WebContents } from "electron";
import {
  IpcChannels,
  createWorkspaceInputSchema,
  requestPlanInputSchema,
  taskDispatchInputSchema,
  approvalResolveInputSchema,
  connectionSetInputSchema,
  secretSetApiKeyInputSchema,
  secretHasApiKeyInputSchema,
  agentModelSetInputSchema,
  fsReadDirInputSchema,
  fsReadFileInputSchema,
  fsWriteFileInputSchema,
  terminalStartInputSchema,
  terminalInputSchema,
  terminalKillInputSchema,
  ALL_AGENTS,
  listProviders,
  providerCliKind,
  logger,
  type ConnectionPreference,
  type AgentRole,
  type SecretStore,
  mcpSaveInputSchema,
  mcpRemoveInputSchema,
  mcpToggleInputSchema,
  mcpCallToolInputSchema,
  skillsSaveInputSchema,
  skillsRemoveInputSchema,
  McpManager,
} from "@nexcode/core";
import {
  WorkspaceRepository,
  TaskRepository,
  ApprovalRepository,
  AgentSettingsRepository,
  CostLogRepository,
  McpRepository,
  SkillRepository,
} from "@nexcode/core/db";
import type { Orchestrator } from "@nexcode/core";
import { readDir, readFileText, writeFileText } from "./fsbridge";
import { TerminalManager } from "./terminal";
import { isCliInstalled } from "./cli-detect";

const KEYCHAIN_SERVICE = "nexcode";

export interface IpcContext {
  workspaces: WorkspaceRepository;
  tasks: TaskRepository;
  approvals: ApprovalRepository;
  settings: AgentSettingsRepository;
  costLogs: CostLogRepository;
  orchestrator: Orchestrator;
  secretStore: SecretStore;
  apiKeyCache: Map<string, string>;
  workspaceId: string;
  rootDir: string;
  getWebContents: () => WebContents | null;
  mcp: McpRepository;
  skills: SkillRepository;
  mcpManager: McpManager;
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
    const { request, images } = requestPlanInputSchema.parse(raw);
    return ctx.orchestrator.planRequest(request, images);
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
    for (const agent of ALL_AGENTS) {
      result[agent.role] = ctx.settings.getPreference(ctx.workspaceId, agent.role);
    }
    return result;
  });

  ipcMain.handle(IpcChannels.connectionSet, (_e, raw: unknown) => {
    const { role, preference } = connectionSetInputSchema.parse(raw);
    ctx.settings.setPreference(ctx.workspaceId, role, preference);
    logger.info("connection.set", { role, preference });
  });

  // Faz 2: sağlayıcı/model registry (UI model seçimi için)
  ipcMain.handle(IpcChannels.providerList, () =>
    listProviders().map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      cli: p.cli,
      models: p.models.map((m) => ({ modelId: m.modelId, label: m.label, vision: m.vision })),
    })),
  );

  // Faz 2: agent başına model seçimi (kullanıcı hangi AI'yı seçer)
  ipcMain.handle(IpcChannels.agentModelGetAll, () => {
    const result: Record<string, { provider: string; modelId: string; isDefault: boolean }> = {};
    for (const agent of ALL_AGENTS) {
      const model = ctx.settings.resolveModel(ctx.workspaceId, agent.role);
      const choice = ctx.settings.getModelChoice(ctx.workspaceId, agent.role);
      result[agent.role] = {
        provider: model.provider,
        modelId: model.modelId,
        isDefault: choice === null,
      };
    }
    return result;
  });

  ipcMain.handle(IpcChannels.agentModelSet, (_e, raw: unknown) => {
    const { role, provider, modelId } = agentModelSetInputSchema.parse(raw);
    ctx.settings.setModelChoice(ctx.workspaceId, role, { provider, modelId });
    logger.info("agent_model.set", { role, provider, modelId });
  });

  // Faz 2: maliyet özeti (cost dashboard)
  ipcMain.handle(IpcChannels.costSummary, () => ({
    byConnectionMode: ctx.costLogs.summaryByConnectionMode(),
    totalApiCost: ctx.costLogs.totalApiCost(),
  }));

  // Faz 2: sır/anahtar — OS keychain (PRD §5.7, §12)
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

  // Faz 2: bağlantı durumu — her sağlayıcı için API anahtarı var mı + CLI kurulu mu.
  // UI bunu "API nereye girilir / CLI nasıl bağlanır" netliği için kullanır.
  ipcMain.handle(IpcChannels.connectionStatus, async () => {
    const result: Record<string, { hasApiKey: boolean; cliKind: string | null; cliInstalled: boolean }> = {};
    for (const p of listProviders()) {
      const cliKind = providerCliKind(p.id) ?? null;
      result[p.id] = {
        hasApiKey: ctx.apiKeyCache.has(p.id) || (await ctx.secretStore.get(KEYCHAIN_SERVICE, p.id)) !== null,
        cliKind,
        cliInstalled: cliKind ? isCliInstalled(cliKind) : false,
      };
    }
    return result;
  });

  // MCP
  ipcMain.handle(IpcChannels.mcpList, () => {
    return ctx.mcp.list().map((s) => {
      const active = ctx.mcpManager.listActiveServers().find((item) => item.id === s.id);
      return {
        ...s,
        running: active?.running ?? false,
      };
    });
  });

  ipcMain.handle(IpcChannels.mcpSave, async (_e, raw: unknown) => {
    const input = mcpSaveInputSchema.parse(raw);
    const existing = ctx.mcp.getByName(input.name);
    if (existing) {
      throw new Error(`MCP sunucusu '${input.name}' zaten mevcut`);
    }
    const created = ctx.mcp.create(input);
    if (created.enabled) {
      await ctx.mcpManager.startServer(created);
    }
    return created;
  });

  ipcMain.handle(IpcChannels.mcpRemove, async (_e, raw: unknown) => {
    const { id } = mcpRemoveInputSchema.parse(raw);
    await ctx.mcpManager.stopServer(id);
    ctx.mcp.delete(id);
  });

  ipcMain.handle(IpcChannels.mcpToggle, async (_e, raw: unknown) => {
    const { id, enabled } = mcpToggleInputSchema.parse(raw);
    ctx.mcp.toggle(id, enabled);
    if (enabled) {
      const servers = ctx.mcp.list();
      const s = servers.find((item) => item.id === id);
      if (s) await ctx.mcpManager.startServer(s);
    } else {
      await ctx.mcpManager.stopServer(id);
    }
  });

  ipcMain.handle(IpcChannels.mcpCallTool, async (_e, raw: unknown) => {
    const { serverName, toolName, args } = mcpCallToolInputSchema.parse(raw);
    return await ctx.mcpManager.callTool(serverName, toolName, args);
  });

  // Skills
  ipcMain.handle(IpcChannels.skillsList, () => {
    return ctx.skills.list();
  });

  ipcMain.handle(IpcChannels.skillsSave, (_e, raw: unknown) => {
    const input = skillsSaveInputSchema.parse(raw);
    const existing = ctx.skills.getByName(input.name);
    if (existing) {
      throw new Error(`Skill '${input.name}' zaten mevcut`);
    }
    return ctx.skills.create(input);
  });

  ipcMain.handle(IpcChannels.skillsRemove, (_e, raw: unknown) => {
    const { id } = skillsRemoveInputSchema.parse(raw);
    ctx.skills.delete(id);
  });

  registerFsHandlers(ctx);
  registerTerminalHandlers(ctx);
}

/** IDE kabuğu: Open Folder + dosya ağacı + dosya okuma (PRD §6.1 dosya sistemi erişimi). */
function registerFsHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.fsOpenFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return { root: ctx.rootDir, entries: readDir(ctx.rootDir) };
    ctx.rootDir = result.filePaths[0];
    logger.info("fs.open_folder", { root: ctx.rootDir });
    return { root: ctx.rootDir, entries: readDir(ctx.rootDir) };
  });

  ipcMain.handle(IpcChannels.fsCurrentRoot, () => ({
    root: ctx.rootDir,
    entries: readDir(ctx.rootDir),
  }));

  ipcMain.handle(IpcChannels.fsReadDir, (_e, raw: unknown) => {
    const { path: dir } = fsReadDirInputSchema.parse(raw);
    return readDir(dir);
  });

  ipcMain.handle(IpcChannels.fsReadFile, (_e, raw: unknown) => {
    const { path: file } = fsReadFileInputSchema.parse(raw);
    return readFileText(file);
  });

  ipcMain.handle(IpcChannels.fsWriteFile, (_e, raw: unknown) => {
    const { path: file, content } = fsWriteFileInputSchema.parse(raw);
    writeFileText(file, content);
    logger.info("fs.write_file", { path: file, bytes: content.length });
  });
}

/** Terminal/komut konsolu (PRD §5.2). main → renderer push: terminalData / terminalExit. */
function registerTerminalHandlers(ctx: IpcContext): void {
  const term = new TerminalManager({
    onData: (id, data) => ctx.getWebContents()?.send(IpcChannels.terminalData, { id, data }),
    onExit: (id, code) => ctx.getWebContents()?.send(IpcChannels.terminalExit, { id, code }),
  });

  ipcMain.handle(IpcChannels.terminalStart, (_e, raw: unknown) => {
    const { id, cwd } = terminalStartInputSchema.parse(raw);
    term.start(id, cwd ?? ctx.rootDir);
  });

  ipcMain.handle(IpcChannels.terminalInput, (_e, raw: unknown) => {
    const { id, data } = terminalInputSchema.parse(raw);
    term.run(id, data);
  });

  ipcMain.handle(IpcChannels.terminalKill, (_e, raw: unknown) => {
    const { id } = terminalKillInputSchema.parse(raw);
    term.kill(id);
  });
}

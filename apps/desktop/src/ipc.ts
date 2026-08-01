import { ipcMain, dialog, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import {
  IpcChannels,
  createWorkspaceInputSchema,
  taskCreateInputSchema,
  taskUpdateInputSchema,
  taskIdInputSchema,
  taskEventsInputSchema,
  taskChatInputSchema,
  scheduleSaveInputSchema,
  scheduleToggleInputSchema,
  checkpointListInputSchema,
  checkpointRestoreInputSchema,
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
  mcpSaveInputSchema,
  mcpRemoveInputSchema,
  mcpToggleInputSchema,
  mcpCallToolInputSchema,
  skillsSaveInputSchema,
  skillsRemoveInputSchema,
  normalizeConfig,
  computeNextRun,
  ALL_AGENTS,
  listProviders,
  providerCliKind,
  logger,
  type ConnectionPreference,
  type AgentRole,
  type SecretStore,
  type Schedule,
  type NexcodeConfig,
} from "@nexcode/core";
import {
  WorkspaceRepository,
  EngineRepository,
  ConfigRepository,
  ScheduleRepository,
  ApprovalRepository,
  AgentSettingsRepository,
  CostLogRepository,
  McpRepository,
  SkillRepository,
} from "@nexcode/core/db";
import { McpManager } from "@nexcode/core/mcp";
import { readDir, readFileText, writeFileText } from "./fsbridge";
import { TerminalManager } from "./terminal";
import { isCliInstalled } from "./cli-detect";
import type { EngineHost } from "./engine-host";

const KEYCHAIN_SERVICE = "nexcode";

export interface IpcContext {
  workspaces: WorkspaceRepository;
  tasks: EngineRepository;
  configRepo: ConfigRepository;
  schedules: ScheduleRepository;
  approvals: ApprovalRepository;
  settings: AgentSettingsRepository;
  costLogs: CostLogRepository;
  engine: EngineHost;
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
 * Tüm IPC handler'larını kaydeder. Gelen payload'lar Zod ile doğrulanır.
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

  registerEngineHandlers(ctx);
  registerTaskHandlers(ctx);
  registerConfigHandlers(ctx);
  registerScheduleHandlers(ctx);
  registerCheckpointHandlers(ctx);
  registerApprovalHandlers(ctx);
  registerConnectionHandlers(ctx);
  registerMcpHandlers(ctx);
  registerSkillHandlers(ctx);
  registerFsHandlers(ctx);
  registerTerminalHandlers(ctx);
}

/** Motor: kuyruk döngüsünü başlatır ve durdurur. */
function registerEngineHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.engineStart, () => {
    const cfg = ctx.configRepo.load();
    // Otonom onay olmadan motor başlatılamaz; sessizce başlatmak yerine açık hata verilir.
    if (cfg.autonomousConsentAcceptedAt === null) {
      throw new Error("Otonom çalışma onayı alınmadan motor başlatılamaz.");
    }
    ctx.engine.start();
    return ctx.engine.status();
  });

  ipcMain.handle(IpcChannels.engineStop, async () => {
    await ctx.engine.stop();
    return ctx.engine.status();
  });

  ipcMain.handle(IpcChannels.engineStatus, () => ctx.engine.status());
}

/** Görev kuyruğu ve olay replay'i. */
function registerTaskHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.taskCreate, (_e, raw: unknown) => {
    const input = taskCreateInputSchema.parse(raw);
    const cfg = ctx.configRepo.load();
    const task = ctx.tasks.create({
      prompt: input.prompt,
      workingDir: input.workingDir ?? resolveWorkingDir(cfg, ctx.rootDir),
      ...(input.executionMode !== undefined ? { executionMode: input.executionMode } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    });

    // Motor çalışıyorsa bekleme aralığını kesip görevi hemen alsın.
    ctx.engine.wake();
    logger.info("task.created", { id: task.id });
    return task;
  });

  ipcMain.handle(IpcChannels.taskList, () => ctx.tasks.queueSnapshot());
  ipcMain.handle(IpcChannels.taskGet, (_e, raw: unknown) => ctx.tasks.getById(taskIdInputSchema.parse(raw).id));

  ipcMain.handle(IpcChannels.taskUpdate, (_e, raw: unknown) => {
    const { id, ...changes } = taskUpdateInputSchema.parse(raw);
    const updated = ctx.tasks.updatePending(id, changes);
    if (!updated) throw new Error("Yalnızca bekleyen görevler düzenlenebilir.");
    return ctx.tasks.getById(id);
  });

  ipcMain.handle(IpcChannels.taskRemove, (_e, raw: unknown) => {
    const { id } = taskIdInputSchema.parse(raw);
    if (!ctx.tasks.remove(id)) throw new Error("Çalışan görev silinemez.");
    return ctx.tasks.queueSnapshot();
  });

  // Sayfa açılışında geçmişi replay eder; canlı akışla ortak `seq` sayesinde tekilleştirilir.
  ipcMain.handle(IpcChannels.taskEvents, (_e, raw: unknown) => {
    const { taskId, sinceSeq } = taskEventsInputSchema.parse(raw);
    const events = ctx.tasks.eventsFor(taskId);
    return sinceSeq === undefined ? events : events.filter((event) => event.seq > sinceSeq);
  });

  ipcMain.handle(IpcChannels.taskChatHistory, (_e, raw: unknown) =>
    ctx.tasks.conversationFor(taskIdInputSchema.parse(raw).id),
  );

  // Tamamlanmış görev hakkındaki salt-okunur sohbet: ayrı bir görev kaydı olarak kuyruğa girer.
  ipcMain.handle(IpcChannels.taskChat, (_e, raw: unknown) => {
    const { taskId, message } = taskChatInputSchema.parse(raw);
    const parent = ctx.tasks.getById(taskId);
    if (parent === null) throw new Error(`Görev bulunamadı: ${taskId}`);

    const entry = ctx.tasks.appendConversation(taskId, "user", message);
    ctx.tasks.create({
      prompt: message,
      workingDir: parent.workingDir,
      kind: "operator-chat",
      parentTaskId: taskId,
    });
    ctx.engine.wake();
    return entry;
  });
}

/** Yapılandırma: her yazma normalizasyondan geçer. */
function registerConfigHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.configLoad, () => ctx.configRepo.load());

  ipcMain.handle(IpcChannels.configSave, (_e, raw: unknown) => {
    // Şema doğrulaması normalizasyonun içindedir; geçersiz gövde burada fırlatır.
    const next = normalizeConfig(raw);

    // İzolasyon olmadan paralellik veri kaybına yol açar: sessizce düşürmek yerine bildir.
    if (isConcurrencyRequested(raw) && next.worktree.mode !== "task") {
      throw new Error("Eşzamanlı görev yürütme için worktree izolasyonu (worktree.mode: task) açık olmalıdır.");
    }
    return ctx.configRepo.save(next);
  });

  ipcMain.handle(IpcChannels.configReset, () => ctx.configRepo.resetToTemplate());

  ipcMain.handle(IpcChannels.cliDiscover, () => ctx.configRepo.load().agents);
  ipcMain.handle(IpcChannels.cliHealth, () => {
    const cfg = ctx.configRepo.load();
    return Object.values(cfg.agents).map((agent) => ({
      id: agent.id,
      name: agent.name,
      adapter: agent.adapter ?? null,
      installed: agent.cmd === undefined ? false : isCliInstalled(agent.cmd),
    }));
  });
}

/** Zamanlanmış görevler: CRUD kendi uçlarıyla anında kalıcılaşır. */
function registerScheduleHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.scheduleList, () => withNextRun(ctx.schedules.list()));

  ipcMain.handle(IpcChannels.scheduleSave, (_e, raw: unknown) => {
    const input = scheduleSaveInputSchema.parse(raw);
    const existing = input.id === undefined ? null : ctx.schedules.getById(input.id);

    const schedule: Schedule = {
      id: input.id ?? randomUUID(),
      prompt: input.prompt,
      executionMode: input.executionMode ?? "auto",
      trigger: input.trigger,
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastRunAt: existing?.lastRunAt ?? null,
      nextRunAt: null,
      lastTaskId: existing?.lastTaskId ?? null,
      ...(input.targetDir !== undefined ? { targetDir: input.targetDir } : {}),
      ...(input.operatorAgentId !== undefined ? { operatorAgentId: input.operatorAgentId } : {}),
    };

    return ctx.schedules.save({ ...schedule, nextRunAt: computeNextRun(schedule, new Date()).toISOString() });
  });

  ipcMain.handle(IpcChannels.scheduleRemove, (_e, raw: unknown) => ctx.schedules.remove(taskIdInputSchema.parse(raw).id));

  ipcMain.handle(IpcChannels.scheduleToggle, (_e, raw: unknown) => {
    const { id, enabled } = scheduleToggleInputSchema.parse(raw);
    return ctx.schedules.setEnabled(id, enabled);
  });
}

/** Görev öncesi sürümleme: geri yükleme yalnızca motor boştayken. */
function registerCheckpointHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.checkpointList, (_e, raw: unknown) =>
    ctx.engine.listCheckpoints(checkpointListInputSchema.parse(raw).workingDir),
  );

  ipcMain.handle(IpcChannels.checkpointRestore, async (_e, raw: unknown) => {
    const { id } = checkpointRestoreInputSchema.parse(raw);
    const result = await ctx.engine.restoreCheckpoint(id);
    if (!result.ok) throw new Error(result.error);
    return result.report;
  });
}

function registerApprovalHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.approvalListPending, () => ctx.approvals.listPending());

  ipcMain.handle(IpcChannels.approvalResolve, (_e, raw: unknown) => {
    const { id, status } = approvalResolveInputSchema.parse(raw);
    ctx.approvals.resolve(id, status, "user");
    logger.info("approval.resolved", { id, status });
  });
}

/** Bağlantı modu, sağlayıcı kataloğu, anahtar yönetimi ve maliyet özeti. */
function registerConnectionHandlers(ctx: IpcContext): void {
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

  ipcMain.handle(IpcChannels.providerList, () =>
    listProviders().map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      cli: p.cli,
      models: p.models.map((m) => ({ modelId: m.modelId, label: m.label, vision: m.vision })),
    })),
  );

  ipcMain.handle(IpcChannels.agentModelGetAll, () => {
    const result: Record<string, { provider: string; modelId: string; isDefault: boolean }> = {};
    for (const agent of ALL_AGENTS) {
      const model = ctx.settings.resolveModel(ctx.workspaceId, agent.role);
      result[agent.role] = {
        provider: model.provider,
        modelId: model.modelId,
        isDefault: ctx.settings.getModelChoice(ctx.workspaceId, agent.role) === null,
      };
    }
    return result;
  });

  ipcMain.handle(IpcChannels.agentModelSet, (_e, raw: unknown) => {
    const { role, provider, modelId } = agentModelSetInputSchema.parse(raw);
    ctx.settings.setModelChoice(ctx.workspaceId, role, { provider, modelId });
    logger.info("agent_model.set", { role, provider, modelId });
  });

  ipcMain.handle(IpcChannels.costSummary, () => ({
    byConnectionMode: ctx.costLogs.summaryByConnectionMode(),
    totalApiCost: ctx.costLogs.totalApiCost(),
  }));

  ipcMain.handle(IpcChannels.secretSetApiKey, async (_e, raw: unknown) => {
    const { provider, apiKey } = secretSetApiKeyInputSchema.parse(raw);
    await ctx.secretStore.set(KEYCHAIN_SERVICE, provider, apiKey);
    ctx.apiKeyCache.set(provider, apiKey);
    logger.info("secret.api_key_set", { provider });
  });

  ipcMain.handle(IpcChannels.secretHasApiKey, async (_e, raw: unknown) => {
    const { provider } = secretHasApiKeyInputSchema.parse(raw);
    if (ctx.apiKeyCache.has(provider)) return true;
    return (await ctx.secretStore.get(KEYCHAIN_SERVICE, provider)) !== null;
  });

  ipcMain.handle(IpcChannels.connectionStatus, async () => {
    const result: Record<string, { hasApiKey: boolean; cliKind: string | null; cliInstalled: boolean }> = {};
    for (const p of listProviders()) {
      const cliKind = providerCliKind(p.id) ?? null;
      result[p.id] = {
        hasApiKey: ctx.apiKeyCache.has(p.id) || (await ctx.secretStore.get(KEYCHAIN_SERVICE, p.id)) !== null,
        cliKind,
        cliInstalled: cliKind !== null && isCliInstalled(cliKind),
      };
    }
    return result;
  });
}

function registerMcpHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.mcpList, () =>
    ctx.mcp.list().map((server) => ({
      ...server,
      running: ctx.mcpManager.listActiveServers().find((item) => item.id === server.id)?.running ?? false,
    })),
  );

  ipcMain.handle(IpcChannels.mcpSave, async (_e, raw: unknown) => {
    const input = mcpSaveInputSchema.parse(raw);
    if (ctx.mcp.getByName(input.name) !== null) throw new Error(`MCP sunucusu '${input.name}' zaten mevcut`);

    const created = ctx.mcp.create(input);
    if (created.enabled) await ctx.mcpManager.startServer(created);
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

    if (!enabled) {
      await ctx.mcpManager.stopServer(id);
      return;
    }
    const server = ctx.mcp.list().find((item) => item.id === id);
    if (server !== undefined) await ctx.mcpManager.startServer(server);
  });

  ipcMain.handle(IpcChannels.mcpCallTool, async (_e, raw: unknown) => {
    const { serverName, toolName, args } = mcpCallToolInputSchema.parse(raw);
    return await ctx.mcpManager.callTool(serverName, toolName, args);
  });
}

function registerSkillHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.skillsList, () => ctx.skills.list());

  ipcMain.handle(IpcChannels.skillsSave, (_e, raw: unknown) => {
    const input = skillsSaveInputSchema.parse(raw);
    if (ctx.skills.getByName(input.name) !== null) throw new Error(`Skill '${input.name}' zaten mevcut`);
    return ctx.skills.create(input);
  });

  ipcMain.handle(IpcChannels.skillsRemove, (_e, raw: unknown) => {
    ctx.skills.delete(skillsRemoveInputSchema.parse(raw).id);
  });
}

/** IDE kabuğu: Open Folder, dosya ağacı, dosya okuma ve yazma. */
function registerFsHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.fsOpenFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    const picked = result.filePaths[0];
    if (result.canceled || picked === undefined) return { root: ctx.rootDir, entries: readDir(ctx.rootDir) };

    ctx.rootDir = picked;
    logger.info("fs.open_folder", { root: ctx.rootDir });
    return { root: ctx.rootDir, entries: readDir(ctx.rootDir) };
  });

  ipcMain.handle(IpcChannels.fsCurrentRoot, () => ({ root: ctx.rootDir, entries: readDir(ctx.rootDir) }));
  ipcMain.handle(IpcChannels.fsReadDir, (_e, raw: unknown) => readDir(fsReadDirInputSchema.parse(raw).path));
  ipcMain.handle(IpcChannels.fsReadFile, (_e, raw: unknown) => readFileText(fsReadFileInputSchema.parse(raw).path));

  ipcMain.handle(IpcChannels.fsWriteFile, (_e, raw: unknown) => {
    const { path: file, content } = fsWriteFileInputSchema.parse(raw);
    writeFileText(file, content);
    logger.info("fs.write_file", { path: file, bytes: content.length });
  });
}

/** Terminal oturumu. main -> renderer push: terminalData / terminalExit. */
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
    term.kill(terminalKillInputSchema.parse(raw).id);
  });
}

/** `.` yapılandırması uygulamanın açtığı klasörü işaret eder. */
function resolveWorkingDir(cfg: NexcodeConfig, rootDir: string): string {
  return cfg.workingDir === "." || cfg.workingDir === "" ? rootDir : cfg.workingDir;
}

/** Kaydedilmek istenen gövdede 1'den büyük eşzamanlılık var mı (normalizasyon öncesi). */
function isConcurrencyRequested(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const value = (raw as { maxConcurrentTasks?: unknown }).maxConcurrentTasks;
  return typeof value === "number" && value > 1;
}

/** Listeleme sırasında sonraki çalışma zamanı taze hesaplanır (kayıt bayatlamış olabilir). */
function withNextRun(schedules: Schedule[]): Schedule[] {
  const now = new Date();
  return schedules.map((schedule) => ({
    ...schedule,
    nextRunAt: schedule.enabled ? computeNextRun(schedule, now).toISOString() : null,
  }));
}

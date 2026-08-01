import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// Kanal adları @nexcode/core/ipc/channels ile birebir aynı olmalıdır.
// Preload bağımlılıksız tutulduğundan (sandbox uyumu) sabitler burada tekrarlanır.
const C = {
  workspaceCreate: "workspace:create",
  workspaceList: "workspace:list",
  engineStart: "engine:start",
  engineStop: "engine:stop",
  engineStatus: "engine:status",
  engineEvent: "engine:event",
  taskCreate: "task:create",
  taskList: "task:list",
  taskGet: "task:get",
  taskUpdate: "task:update",
  taskRemove: "task:remove",
  taskEvents: "task:events",
  taskChat: "task:chat",
  taskChatHistory: "task:chat-history",
  configLoad: "config:load",
  configSave: "config:save",
  configReset: "config:reset",
  scheduleList: "schedule:list",
  scheduleSave: "schedule:save",
  scheduleRemove: "schedule:remove",
  scheduleToggle: "schedule:toggle",
  checkpointList: "checkpoint:list",
  checkpointRestore: "checkpoint:restore",
  cliDiscover: "cli:discover",
  cliHealth: "cli:health",
  approvalListPending: "approval:list-pending",
  approvalResolve: "approval:resolve",
  connectionGetAll: "connection:get-all",
  connectionSet: "connection:set",
  secretSetApiKey: "secret:set-api-key",
  secretHasApiKey: "secret:has-api-key",
  providerList: "provider:list",
  agentModelGetAll: "agent-model:get-all",
  agentModelSet: "agent-model:set",
  costSummary: "cost:summary",
  fsOpenFolder: "fs:open-folder",
  fsReadDir: "fs:read-dir",
  fsReadFile: "fs:read-file",
  fsWriteFile: "fs:write-file",
  fsCurrentRoot: "fs:current-root",
  connectionStatus: "connection:status",
  terminalStart: "terminal:start",
  terminalInput: "terminal:input",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  terminalData: "terminal:data",
  terminalExit: "terminal:exit",
  // MCP
  mcpList: "mcp:list",
  mcpSave: "mcp:save",
  mcpRemove: "mcp:remove",
  mcpToggle: "mcp:toggle",
  mcpCallTool: "mcp:call-tool",
  // Skills
  skillsList: "skills:list",
  skillsSave: "skills:save",
  skillsRemove: "skills:remove",
} as const;

const api = {
  createWorkspace: (input: { name: string; repoPath: string }): Promise<unknown> =>
    ipcRenderer.invoke(C.workspaceCreate, input),
  listWorkspaces: (): Promise<unknown> => ipcRenderer.invoke(C.workspaceList),

  // Motor: kuyruk döngüsü
  engineStart: (): Promise<unknown> => ipcRenderer.invoke(C.engineStart),
  engineStop: (): Promise<unknown> => ipcRenderer.invoke(C.engineStop),
  engineStatus: (): Promise<unknown> => ipcRenderer.invoke(C.engineStatus),
  /** Motorun canlı olay akışı; abonelikten çıkmak için dönen fonksiyon çağrılır. */
  onEngineEvent: (cb: (event: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: unknown): void => cb(payload);
    ipcRenderer.on(C.engineEvent, listener);
    return () => ipcRenderer.removeListener(C.engineEvent, listener);
  },

  // Görev kuyruğu
  createTask: (input: {
    prompt: string;
    workingDir?: string;
    executionMode?: string;
    priority?: number;
  }): Promise<unknown> => ipcRenderer.invoke(C.taskCreate, input),
  listTasks: (): Promise<unknown> => ipcRenderer.invoke(C.taskList),
  getTask: (id: string): Promise<unknown> => ipcRenderer.invoke(C.taskGet, { id }),
  updateTask: (input: { id: string; prompt?: string; workingDir?: string; executionMode?: string }): Promise<unknown> =>
    ipcRenderer.invoke(C.taskUpdate, input),
  removeTask: (id: string): Promise<unknown> => ipcRenderer.invoke(C.taskRemove, { id }),
  taskEvents: (taskId: string, sinceSeq?: number): Promise<unknown> =>
    ipcRenderer.invoke(C.taskEvents, { taskId, sinceSeq }),
  taskChat: (taskId: string, message: string): Promise<unknown> =>
    ipcRenderer.invoke(C.taskChat, { taskId, message }),
  taskChatHistory: (id: string): Promise<unknown> => ipcRenderer.invoke(C.taskChatHistory, { id }),

  // Yapılandırma
  loadConfig: (): Promise<unknown> => ipcRenderer.invoke(C.configLoad),
  saveConfig: (config: unknown): Promise<unknown> => ipcRenderer.invoke(C.configSave, config),
  resetConfig: (): Promise<unknown> => ipcRenderer.invoke(C.configReset),

  // Zamanlanmış görevler
  listSchedules: (): Promise<unknown> => ipcRenderer.invoke(C.scheduleList),
  saveSchedule: (input: unknown): Promise<unknown> => ipcRenderer.invoke(C.scheduleSave, input),
  removeSchedule: (id: string): Promise<unknown> => ipcRenderer.invoke(C.scheduleRemove, { id }),
  toggleSchedule: (id: string, enabled: boolean): Promise<unknown> =>
    ipcRenderer.invoke(C.scheduleToggle, { id, enabled }),

  // Görev öncesi sürümleme
  listCheckpoints: (workingDir: string): Promise<unknown> => ipcRenderer.invoke(C.checkpointList, { workingDir }),
  restoreCheckpoint: (id: string): Promise<unknown> => ipcRenderer.invoke(C.checkpointRestore, { id }),

  // CLI keşfi
  discoverClis: (): Promise<unknown> => ipcRenderer.invoke(C.cliDiscover),
  cliHealth: (): Promise<unknown> => ipcRenderer.invoke(C.cliHealth),

  listPendingApprovals: (): Promise<unknown> => ipcRenderer.invoke(C.approvalListPending),
  resolveApproval: (id: string, status: "approved" | "rejected"): Promise<unknown> =>
    ipcRenderer.invoke(C.approvalResolve, { id, status }),

  getConnections: (): Promise<unknown> => ipcRenderer.invoke(C.connectionGetAll),
  setConnection: (role: string, preference: string): Promise<unknown> =>
    ipcRenderer.invoke(C.connectionSet, { role, preference }),

  setApiKey: (provider: string, apiKey: string): Promise<unknown> =>
    ipcRenderer.invoke(C.secretSetApiKey, { provider, apiKey }),
  hasApiKey: (provider: string): Promise<unknown> =>
    ipcRenderer.invoke(C.secretHasApiKey, { provider }),

  // Faz 2: model seçimi
  listProviders: (): Promise<unknown> => ipcRenderer.invoke(C.providerList),
  getAgentModels: (): Promise<unknown> => ipcRenderer.invoke(C.agentModelGetAll),
  setAgentModel: (role: string, provider: string, modelId: string): Promise<unknown> =>
    ipcRenderer.invoke(C.agentModelSet, { role, provider, modelId }),

  // Faz 2: maliyet
  getCostSummary: (): Promise<unknown> => ipcRenderer.invoke(C.costSummary),

  // Faz 2: bağlantı durumu (API anahtarı + CLI kurulu mu)
  getConnectionStatus: (): Promise<unknown> => ipcRenderer.invoke(C.connectionStatus),

  // Faz 2: dosya sistemi (IDE kabuğu)
  openFolder: (): Promise<unknown> => ipcRenderer.invoke(C.fsOpenFolder),
  currentRoot: (): Promise<unknown> => ipcRenderer.invoke(C.fsCurrentRoot),
  readDir: (path: string): Promise<unknown> => ipcRenderer.invoke(C.fsReadDir, { path }),
  readFile: (path: string): Promise<unknown> => ipcRenderer.invoke(C.fsReadFile, { path }),
  writeFile: (path: string, content: string): Promise<unknown> =>
    ipcRenderer.invoke(C.fsWriteFile, { path, content }),

  // Faz 2: terminal
  terminalStart: (id: string, cwd?: string): Promise<unknown> =>
    ipcRenderer.invoke(C.terminalStart, { id, cwd }),
  terminalInput: (id: string, data: string): Promise<unknown> =>
    ipcRenderer.invoke(C.terminalInput, { id, data }),
  terminalKill: (id: string): Promise<unknown> => ipcRenderer.invoke(C.terminalKill, { id }),
  onTerminalData: (cb: (payload: { id: string; data: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { id: string; data: string }): void => cb(payload);
    ipcRenderer.on(C.terminalData, listener);
    return () => ipcRenderer.removeListener(C.terminalData, listener);
  },
  onTerminalExit: (cb: (payload: { id: string; code: number }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { id: string; code: number }): void => cb(payload);
    ipcRenderer.on(C.terminalExit, listener);
    return () => ipcRenderer.removeListener(C.terminalExit, listener);
  },

  // MCP
  listMcpServers: (): Promise<unknown> => ipcRenderer.invoke(C.mcpList),
  saveMcpServer: (input: { name: string; command: string; args: string[]; env: Record<string, string> }): Promise<unknown> =>
    ipcRenderer.invoke(C.mcpSave, input),
  removeMcpServer: (id: string): Promise<unknown> => ipcRenderer.invoke(C.mcpRemove, { id }),
  toggleMcpServer: (id: string, enabled: boolean): Promise<unknown> =>
    ipcRenderer.invoke(C.mcpToggle, { id, enabled }),
  callMcpTool: (serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke(C.mcpCallTool, { serverName, toolName, args }),

  // Skills
  listSkills: (): Promise<unknown> => ipcRenderer.invoke(C.skillsList),
  saveSkill: (input: { name: string; description: string; prompt: string }): Promise<unknown> =>
    ipcRenderer.invoke(C.skillsSave, input),
  removeSkill: (id: string): Promise<unknown> => ipcRenderer.invoke(C.skillsRemove, { id }),
};

contextBridge.exposeInMainWorld("nexcode", api);

export type NexcodeApi = typeof api;

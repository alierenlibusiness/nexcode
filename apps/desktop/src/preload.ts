import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// Kanal adları @nexcode/core/ipc/channels ile birebir aynı olmalıdır.
// Preload bağımlılıksız tutulduğundan (sandbox uyumu) sabitler burada tekrarlanır.
const C = {
  workspaceCreate: "workspace:create",
  workspaceList: "workspace:list",
  requestPlan: "request:plan",
  taskList: "task:list",
  taskDispatch: "task:dispatch",
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
  fsCurrentRoot: "fs:current-root",
  terminalStart: "terminal:start",
  terminalInput: "terminal:input",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  terminalData: "terminal:data",
  terminalExit: "terminal:exit",
} as const;

const api = {
  createWorkspace: (input: { name: string; repoPath: string }): Promise<unknown> =>
    ipcRenderer.invoke(C.workspaceCreate, input),
  listWorkspaces: (): Promise<unknown> => ipcRenderer.invoke(C.workspaceList),

  planRequest: (request: string): Promise<unknown> =>
    ipcRenderer.invoke(C.requestPlan, { request }),
  listTasks: (): Promise<unknown> => ipcRenderer.invoke(C.taskList),
  dispatchTask: (taskId: string): Promise<unknown> =>
    ipcRenderer.invoke(C.taskDispatch, { taskId }),

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

  // Faz 2: dosya sistemi (IDE kabuğu)
  openFolder: (): Promise<unknown> => ipcRenderer.invoke(C.fsOpenFolder),
  currentRoot: (): Promise<unknown> => ipcRenderer.invoke(C.fsCurrentRoot),
  readDir: (path: string): Promise<unknown> => ipcRenderer.invoke(C.fsReadDir, { path }),
  readFile: (path: string): Promise<unknown> => ipcRenderer.invoke(C.fsReadFile, { path }),

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
};

contextBridge.exposeInMainWorld("nexcode", api);

export type NexcodeApi = typeof api;

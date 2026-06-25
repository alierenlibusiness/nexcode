import { contextBridge, ipcRenderer } from "electron";

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
};

contextBridge.exposeInMainWorld("nexcode", api);

export type NexcodeApi = typeof api;

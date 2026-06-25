import { contextBridge, ipcRenderer } from "electron";

// Kanal adları @nexcode/core/ipc/channels ile birebir aynı olmalıdır.
// Preload bağımlılıksız tutulduğundan (sandbox uyumu) sabitler burada tekrarlanır.
const Channels = {
  workspaceCreate: "workspace:create",
  workspaceList: "workspace:list",
} as const;

const api = {
  createWorkspace: (input: { name: string; repoPath: string }): Promise<unknown> =>
    ipcRenderer.invoke(Channels.workspaceCreate, input),
  listWorkspaces: (): Promise<unknown> => ipcRenderer.invoke(Channels.workspaceList),
};

contextBridge.exposeInMainWorld("nexcode", api);

export type NexcodeApi = typeof api;

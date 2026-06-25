/**
 * IPC kanal adları — bağımlılıksız sabitler.
 * (Native/zod bağımlılığı olmadığından preload tarafından da güvenle import edilebilir.)
 */
export const IpcChannels = {
  workspaceCreate: "workspace:create",
  workspaceList: "workspace:list",
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

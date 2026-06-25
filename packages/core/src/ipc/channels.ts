/**
 * IPC kanal adları — bağımlılıksız sabitler.
 * (Native/zod bağımlılığı olmadığından preload tarafından da güvenle import edilebilir.)
 */
export const IpcChannels = {
  workspaceCreate: "workspace:create",
  workspaceList: "workspace:list",
  // Faz 1 orkestrasyon
  requestPlan: "request:plan",
  taskList: "task:list",
  taskDispatch: "task:dispatch",
  approvalListPending: "approval:list-pending",
  approvalResolve: "approval:resolve",
  // Bağlantı modu (API/CLI) ayarları
  connectionGetAll: "connection:get-all",
  connectionSet: "connection:set",
  // Sır/anahtar yönetimi (OS keychain)
  secretSetApiKey: "secret:set-api-key",
  secretHasApiKey: "secret:has-api-key",
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

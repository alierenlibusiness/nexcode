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
  // Faz 2: sağlayıcı/model registry + agent başına model seçimi
  providerList: "provider:list",
  agentModelGetAll: "agent-model:get-all",
  agentModelSet: "agent-model:set",
  // Faz 2: maliyet özeti (cost dashboard)
  costSummary: "cost:summary",
  // Faz 2: dosya sistemi (IDE kabuğu — open folder / ağaç / dosya okuma)
  fsOpenFolder: "fs:open-folder",
  fsReadDir: "fs:read-dir",
  fsReadFile: "fs:read-file",
  fsWriteFile: "fs:write-file",
  fsCurrentRoot: "fs:current-root",
  // CLI kurulu mu + API anahtarı var mı (bağlantı durumu)
  connectionStatus: "connection:status",
  // Faz 2: terminal (shell session)
  terminalStart: "terminal:start",
  terminalInput: "terminal:input",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  // main → renderer event kanalları (push)
  terminalData: "terminal:data",
  terminalExit: "terminal:exit",
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

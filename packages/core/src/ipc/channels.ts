/**
 * IPC kanal adları: bağımlılıksız sabitler.
 * (Native/zod bağımlılığı olmadığından preload tarafından da güvenle import edilebilir.)
 */
export const IpcChannels = {
  workspaceCreate: "workspace:create",
  workspaceList: "workspace:list",

  // Motor: kuyruk döngüsü ve slot durumu
  engineStart: "engine:start",
  engineStop: "engine:stop",
  engineStatus: "engine:status",

  // Görev kuyruğu (operatör yönetimli motor)
  taskCreate: "task:create",
  taskList: "task:list",
  taskGet: "task:get",
  taskUpdate: "task:update",
  taskRemove: "task:remove",
  /** Sayfa açılışında kalıcı olay geçmişini replay eder. */
  taskEvents: "task:events",
  /** Tamamlanmış görev hakkındaki salt-okunur operatör sohbeti. */
  taskChat: "task:chat",
  taskChatHistory: "task:chat-history",

  // Yapılandırma
  configLoad: "config:load",
  configSave: "config:save",
  configReset: "config:reset",

  // Zamanlanmış görevler
  scheduleList: "schedule:list",
  scheduleSave: "schedule:save",
  scheduleRemove: "schedule:remove",
  scheduleToggle: "schedule:toggle",

  // Görev öncesi sürümleme
  checkpointList: "checkpoint:list",
  checkpointRestore: "checkpoint:restore",

  // Onay kuyruğu
  approvalListPending: "approval:list-pending",
  approvalResolve: "approval:resolve",

  // CLI keşfi ve sağlık
  cliDiscover: "cli:discover",
  cliHealth: "cli:health",

  // Bağlantı modu (API/CLI) ayarları
  connectionGetAll: "connection:get-all",
  connectionSet: "connection:set",
  connectionStatus: "connection:status",

  // Sır/anahtar yönetimi (OS keychain)
  secretSetApiKey: "secret:set-api-key",
  secretHasApiKey: "secret:has-api-key",

  // Sağlayıcı/model registry + agent başına model seçimi
  providerList: "provider:list",
  agentModelGetAll: "agent-model:get-all",
  agentModelSet: "agent-model:set",

  // Maliyet özeti
  costSummary: "cost:summary",

  // Dosya sistemi (IDE kabuğu)
  fsOpenFolder: "fs:open-folder",
  fsReadDir: "fs:read-dir",
  fsReadFile: "fs:read-file",
  fsWriteFile: "fs:write-file",
  fsCurrentRoot: "fs:current-root",

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

  // Terminal (shell session)
  terminalStart: "terminal:start",
  terminalInput: "terminal:input",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",

  // main -> renderer push kanalları
  /** Motorun canlı olay akışı (status, queue, activity, log, result, filechange). */
  engineEvent: "engine:event",
  terminalData: "terminal:data",
  terminalExit: "terminal:exit",
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

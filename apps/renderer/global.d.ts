import type {
  Workspace,
  Task,
  AgentRole,
  ConnectionPreference,
  JsonObject,
  JsonValue,
} from "@nexcode/core";

export interface ApprovalDTO {
  id: string;
  taskId: string;
  actionType: string;
  status: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface ProviderModelDTO {
  modelId: string;
  label: string;
  vision?: boolean;
}
export interface ProviderInfoDTO {
  id: string;
  label: string;
  kind: "anthropic" | "openai-compatible" | "google";
  cli?: string;
  models: ProviderModelDTO[];
}
export type AgentModelMap = Record<string, { provider: string; modelId: string; isDefault: boolean }>;

export interface FsEntryDTO {
  name: string;
  path: string;
  kind: "file" | "directory";
}
export interface RootListingDTO {
  root: string;
  entries: FsEntryDTO[];
}
export interface FileContentDTO {
  path: string;
  content: string;
  truncated: boolean;
  tooLarge: boolean;
}
export interface CostSummaryDTO {
  byConnectionMode: Array<{
    key: string;
    usdCost: number;
    inputTokens: number;
    outputTokens: number;
    count: number;
  }>;
  totalApiCost: number;
}
export type ConnectionStatusMap = Record<
  string,
  { hasApiKey: boolean; cliKind: string | null; cliInstalled: boolean }
>;

declare global {
  interface Window {
    /** Electron preload tarafından enjekte edilen güvenli IPC köprüsü. */
    nexcode?: {
      createWorkspace(input: { name: string; repoPath: string }): Promise<Workspace>;
      listWorkspaces(): Promise<Workspace[]>;
      planRequest(request: string, images?: Array<{ mimeType: string; data: string }>): Promise<{ tasks: Task[]; textResponse?: string }>;
      listTasks(): Promise<Task[]>;
      dispatchTask(taskId: string): Promise<{ output: string }>;
      listPendingApprovals(): Promise<ApprovalDTO[]>;
      resolveApproval(id: string, status: "approved" | "rejected"): Promise<void>;
      getConnections(): Promise<Partial<Record<AgentRole, ConnectionPreference>>>;
      setConnection(role: AgentRole, preference: ConnectionPreference): Promise<void>;
      setApiKey(provider: string, apiKey: string): Promise<void>;
      hasApiKey(provider: string): Promise<boolean>;
      // Faz 2: model seçimi
      listProviders(): Promise<ProviderInfoDTO[]>;
      getAgentModels(): Promise<AgentModelMap>;
      setAgentModel(role: AgentRole, provider: string, modelId: string): Promise<void>;
      // Faz 2: maliyet
      getCostSummary(): Promise<CostSummaryDTO>;
      // Faz 2: bağlantı durumu
      getConnectionStatus(): Promise<ConnectionStatusMap>;
      // Faz 2: dosya sistemi (IDE kabuğu)
      openFolder(): Promise<RootListingDTO>;
      currentRoot(): Promise<RootListingDTO>;
      readDir(path: string): Promise<FsEntryDTO[]>;
      readFile(path: string): Promise<FileContentDTO>;
      writeFile(path: string, content: string): Promise<void>;
      // Faz 2: terminal
      terminalStart(id: string, cwd?: string): Promise<void>;
      terminalInput(id: string, data: string): Promise<void>;
      terminalKill(id: string): Promise<void>;
      onTerminalData(cb: (payload: { id: string; data: string }) => void): () => void;
      onTerminalExit(cb: (payload: { id: string; code: number }) => void): () => void;

      // MCP
      listMcpServers(): Promise<Array<{ id: string; name: string; command: string; args: string[]; env: Record<string, string>; enabled: boolean; running: boolean }>>;
      saveMcpServer(input: { name: string; command: string; args: string[]; env: Record<string, string> }): Promise<{ id: string; name: string; command: string; args: string[]; env: Record<string, string>; enabled: boolean }>;
      removeMcpServer(id: string): Promise<void>;
      toggleMcpServer(id: string, enabled: boolean): Promise<void>;
      callMcpTool(serverName: string, toolName: string, args: JsonObject): Promise<JsonValue>;

      // Skills
      listSkills(): Promise<Array<{ id: string; name: string; description: string; prompt: string; createdAt: string }>>;
      saveSkill(input: { name: string; description: string; prompt: string }): Promise<{ id: string; name: string; description: string; prompt: string; createdAt: string }>;
      removeSkill(id: string): Promise<void>;
    };
  }
}

export {};

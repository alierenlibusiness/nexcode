import type {
  Workspace,
  Task,
  AgentRole,
  ConnectionPreference,
  EngineEvent,
  QueueSnapshot,
  NexcodeConfig,
  Schedule,
  CheckpointMeta,
  RestoreReport,
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

export interface EngineStatusDTO {
  running: boolean;
  activeIds: string[];
  concurrency: number;
  freeSlots: number;
}

export interface ConversationEntryDTO {
  id: string;
  role: "user" | "operator";
  content: string;
  createdAt: string;
}

export interface CliHealthDTO {
  id: string;
  name: string;
  adapter: string | null;
  installed: boolean;
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

      // Motor
      engineStart(): Promise<EngineStatusDTO>;
      engineStop(): Promise<EngineStatusDTO>;
      engineStatus(): Promise<EngineStatusDTO>;
      onEngineEvent(cb: (event: EngineEvent) => void): () => void;

      // Görev kuyruğu
      createTask(input: {
        prompt: string;
        workingDir?: string;
        executionMode?: string;
        priority?: number;
      }): Promise<Task>;
      listTasks(): Promise<QueueSnapshot>;
      getTask(id: string): Promise<Task | null>;
      updateTask(input: {
        id: string;
        prompt?: string;
        workingDir?: string;
        executionMode?: string;
      }): Promise<Task | null>;
      removeTask(id: string): Promise<QueueSnapshot>;
      taskEvents(taskId: string, sinceSeq?: number): Promise<EngineEvent[]>;
      taskChat(taskId: string, message: string): Promise<ConversationEntryDTO>;
      taskChatHistory(id: string): Promise<ConversationEntryDTO[]>;

      // Yapılandırma
      loadConfig(): Promise<NexcodeConfig>;
      saveConfig(config: NexcodeConfig): Promise<NexcodeConfig>;
      resetConfig(): Promise<NexcodeConfig>;

      // Zamanlanmış görevler
      listSchedules(): Promise<Schedule[]>;
      saveSchedule(input: {
        id?: string;
        prompt: string;
        targetDir?: string;
        executionMode?: string;
        trigger: Schedule["trigger"];
        enabled?: boolean;
      }): Promise<Schedule>;
      removeSchedule(id: string): Promise<boolean>;
      toggleSchedule(id: string, enabled: boolean): Promise<Schedule | null>;

      // Görev öncesi sürümleme
      listCheckpoints(workingDir: string): Promise<CheckpointMeta[]>;
      restoreCheckpoint(id: string): Promise<RestoreReport>;

      // CLI keşfi
      discoverClis(): Promise<Record<string, { id: string; name: string; adapter?: string }>>;
      cliHealth(): Promise<CliHealthDTO[]>;

      listPendingApprovals(): Promise<ApprovalDTO[]>;
      resolveApproval(id: string, status: "approved" | "rejected"): Promise<void>;

      getConnections(): Promise<Partial<Record<AgentRole, ConnectionPreference>>>;
      setConnection(role: AgentRole, preference: ConnectionPreference): Promise<void>;
      setApiKey(provider: string, apiKey: string): Promise<void>;
      hasApiKey(provider: string): Promise<boolean>;
      listProviders(): Promise<ProviderInfoDTO[]>;
      getAgentModels(): Promise<AgentModelMap>;
      setAgentModel(role: AgentRole, provider: string, modelId: string): Promise<void>;
      getCostSummary(): Promise<CostSummaryDTO>;
      getConnectionStatus(): Promise<ConnectionStatusMap>;

      // Dosya sistemi (IDE kabuğu)
      openFolder(): Promise<RootListingDTO>;
      currentRoot(): Promise<RootListingDTO>;
      readDir(path: string): Promise<FsEntryDTO[]>;
      readFile(path: string): Promise<FileContentDTO>;
      writeFile(path: string, content: string): Promise<void>;

      // Terminal
      terminalStart(id: string, cwd?: string): Promise<void>;
      terminalInput(id: string, data: string): Promise<void>;
      terminalKill(id: string): Promise<void>;
      onTerminalData(cb: (payload: { id: string; data: string }) => void): () => void;
      onTerminalExit(cb: (payload: { id: string; code: number }) => void): () => void;

      // MCP
      listMcpServers(): Promise<
        Array<{
          id: string;
          name: string;
          command: string;
          args: string[];
          env: Record<string, string>;
          enabled: boolean;
          running: boolean;
        }>
      >;
      saveMcpServer(input: {
        name: string;
        command: string;
        args: string[];
        env: Record<string, string>;
      }): Promise<{ id: string; name: string; command: string; args: string[]; env: Record<string, string>; enabled: boolean }>;
      removeMcpServer(id: string): Promise<void>;
      toggleMcpServer(id: string, enabled: boolean): Promise<void>;
      callMcpTool(serverName: string, toolName: string, args: JsonObject): Promise<JsonValue>;

      // Skills
      listSkills(): Promise<Array<{ id: string; name: string; description: string; prompt: string; createdAt: string }>>;
      saveSkill(input: {
        name: string;
        description: string;
        prompt: string;
      }): Promise<{ id: string; name: string; description: string; prompt: string; createdAt: string }>;
      removeSkill(id: string): Promise<void>;
    };
  }
}

export {};

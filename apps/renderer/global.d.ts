import type { Workspace, Task, AgentRole, ConnectionPreference } from "@nexcode/core";

export interface ApprovalDTO {
  id: string;
  taskId: string;
  actionType: string;
  status: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

declare global {
  interface Window {
    /** Electron preload tarafından enjekte edilen güvenli IPC köprüsü. */
    nexcode?: {
      createWorkspace(input: { name: string; repoPath: string }): Promise<Workspace>;
      listWorkspaces(): Promise<Workspace[]>;
      planRequest(request: string): Promise<Task[]>;
      listTasks(): Promise<Task[]>;
      dispatchTask(taskId: string): Promise<{ output: string }>;
      listPendingApprovals(): Promise<ApprovalDTO[]>;
      resolveApproval(id: string, status: "approved" | "rejected"): Promise<void>;
      getConnections(): Promise<Partial<Record<AgentRole, ConnectionPreference>>>;
      setConnection(role: AgentRole, preference: ConnectionPreference): Promise<void>;
      setApiKey(provider: string, apiKey: string): Promise<void>;
      hasApiKey(provider: string): Promise<boolean>;
    };
  }
}

export {};

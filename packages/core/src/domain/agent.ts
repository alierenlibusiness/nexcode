/** The six built-in agent roles. */
export type AgentRole = "ceo" | "frontend" | "backend" | "security" | "qa" | "devops";

/** The agent state machine. */
export type AgentStatus =
  | "idle"
  | "thinking"
  | "coding"
  | "testing"
  | "reviewing"
  | "blocked"
  | "completed";

/** Graduated autonomy levels. */
export type AutonomyLevel = "manual" | "supervised" | "autonomous";

/** Connection mode: API key or CLI subscription. */
export type ConnectionMode = "api" | "cli";

/** The model reference an agent connects through. */
export interface ModelRef {
  provider: string;
  modelId: string;
  connectionMode: ConnectionMode;
}

export interface CostBudget {
  maxTokensPerTask: number;
  maxUsdPerDay: number;
}

/** The agent data model. */
export interface Agent {
  id: string;
  workspaceId: string;
  role: AgentRole;
  model: ModelRef;
  status: AgentStatus;
  autonomyLevel: AutonomyLevel;
  costBudget?: CostBudget;
}

export const AGENT_ROLES: readonly AgentRole[] = [
  "ceo",
  "frontend",
  "backend",
  "security",
  "qa",
  "devops",
];

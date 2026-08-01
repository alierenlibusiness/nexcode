/** Yerleşik 6 agent rolü (PRD §8). */
export type AgentRole = "ceo" | "frontend" | "backend" | "security" | "qa" | "devops";

/** Agent durum makinesi (PRD §10). */
export type AgentStatus =
  | "idle"
  | "thinking"
  | "coding"
  | "testing"
  | "reviewing"
  | "blocked"
  | "completed";

/** Kademeli otonomi seviyeleri (PRD Prensip 12). */
export type AutonomyLevel = "manual" | "supervised" | "autonomous";

/** Bağlantı modu: API anahtarı ya da CLI abonelik (PRD §9). */
export type ConnectionMode = "api" | "cli";

/** Bir agent'ın bağlandığı model referansı (PRD §7). */
export interface ModelRef {
  provider: string;
  modelId: string;
  connectionMode: ConnectionMode;
}

export interface CostBudget {
  maxTokensPerTask: number;
  maxUsdPerDay: number;
}

/** Agent veri modeli (PRD §7, §14). */
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

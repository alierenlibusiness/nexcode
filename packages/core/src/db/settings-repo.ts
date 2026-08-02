import type { DB } from "./connection";
import type { AgentRole, ModelRef } from "../domain/agent";
import {
  type ConnectionPreference,
  DEFAULT_CONNECTION_PREFERENCE,
  isConnectionPreference,
} from "../providers/connection";
import { getAgentDefinition } from "../agents/definitions";
import { isKnownModel } from "../providers/registry";

/** The model the user picked for an agent (provider plus modelId). */
export interface AgentModelChoice {
  provider: string;
  modelId: string;
}

interface SettingsRow {
  connection_preference: string;
  model_provider: string | null;
  model_id: string | null;
}

/** Stores the per-agent connection mode and model selection in SQLite. */
export class AgentSettingsRepository {
  constructor(private readonly db: DB) {}

  private getRow(workspaceId: string, role: AgentRole): SettingsRow | undefined {
    return this.db
      .prepare(
        `SELECT connection_preference, model_provider, model_id
         FROM agent_settings WHERE workspace_id = ? AND role = ?`,
      )
      .get(workspaceId, role) as SettingsRow | undefined;
  }

  getPreference(workspaceId: string, role: AgentRole): ConnectionPreference {
    const row = this.getRow(workspaceId, role);
    if (row && isConnectionPreference(row.connection_preference)) {
      return row.connection_preference;
    }
    return DEFAULT_CONNECTION_PREFERENCE;
  }

  setPreference(workspaceId: string, role: AgentRole, preference: ConnectionPreference): void {
    this.db
      .prepare(
        `INSERT INTO agent_settings (workspace_id, role, connection_preference)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_id, role)
         DO UPDATE SET connection_preference = excluded.connection_preference`,
      )
      .run(workspaceId, role, preference);
  }

  /** The model override the user selected (null when there is none). */
  getModelChoice(workspaceId: string, role: AgentRole): AgentModelChoice | null {
    const row = this.getRow(workspaceId, role);
    if (row?.model_provider && row.model_id) {
      return { provider: row.model_provider, modelId: row.model_id };
    }
    return null;
  }

  /** The ModelRef to use for an agent: the user's choice when present, otherwise the agent default. */
  resolveModel(workspaceId: string, role: AgentRole): ModelRef {
    const def = getAgentDefinition(role);
    if (!def) throw new Error(`Unknown agent role: ${role}`);
    const choice = this.getModelChoice(workspaceId, role);
    if (choice) {
      return { ...def.model, provider: choice.provider, modelId: choice.modelId };
    }
    return def.model;
  }

  /** Saves the model the user picked for an agent (it must be valid in the registry). */
  setModelChoice(workspaceId: string, role: AgentRole, choice: AgentModelChoice): void {
    if (!isKnownModel(choice.provider, choice.modelId)) {
      throw new Error(`Unknown model: ${choice.provider}/${choice.modelId} (not in the registry)`);
    }
    this.db
      .prepare(
        `INSERT INTO agent_settings (workspace_id, role, connection_preference, model_provider, model_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, role)
         DO UPDATE SET model_provider = excluded.model_provider, model_id = excluded.model_id`,
      )
      .run(workspaceId, role, DEFAULT_CONNECTION_PREFERENCE, choice.provider, choice.modelId);
  }
}

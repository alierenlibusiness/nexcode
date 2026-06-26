import type { DB } from "./connection";
import type { AgentRole, ModelRef } from "../domain/agent";
import {
  type ConnectionPreference,
  DEFAULT_CONNECTION_PREFERENCE,
  isConnectionPreference,
} from "../providers/connection";
import { getAgentDefinition } from "../agents/definitions";
import { isKnownModel } from "../providers/registry";

/** Kullanıcının agent için seçtiği model (provider + modelId). */
export interface AgentModelChoice {
  provider: string;
  modelId: string;
}

interface SettingsRow {
  connection_preference: string;
  model_provider: string | null;
  model_id: string | null;
}

/** Per-agent bağlantı modu ve model seçimini SQLite'da saklar (PRD §9.5, §7). */
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

  /** Kullanıcının seçtiği model override'ı (yoksa null). */
  getModelChoice(workspaceId: string, role: AgentRole): AgentModelChoice | null {
    const row = this.getRow(workspaceId, role);
    if (row?.model_provider && row.model_id) {
      return { provider: row.model_provider, modelId: row.model_id };
    }
    return null;
  }

  /** Agent için kullanılacak ModelRef: kullanıcı seçimi varsa o, yoksa agent varsayılanı (PRD §7/§8). */
  resolveModel(workspaceId: string, role: AgentRole): ModelRef {
    const def = getAgentDefinition(role);
    if (!def) throw new Error(`Bilinmeyen agent rolü: ${role}`);
    const choice = this.getModelChoice(workspaceId, role);
    if (choice) {
      return { ...def.model, provider: choice.provider, modelId: choice.modelId };
    }
    return def.model;
  }

  /** Kullanıcının agent için seçtiği modeli kaydeder (registry'de geçerli olmalı). */
  setModelChoice(workspaceId: string, role: AgentRole, choice: AgentModelChoice): void {
    if (!isKnownModel(choice.provider, choice.modelId)) {
      throw new Error(`Bilinmeyen model: ${choice.provider}/${choice.modelId} (registry'de yok)`);
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

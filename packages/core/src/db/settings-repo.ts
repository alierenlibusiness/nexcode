import type { DB } from "./connection";
import type { AgentRole } from "../domain/agent";
import {
  type ConnectionPreference,
  DEFAULT_CONNECTION_PREFERENCE,
  isConnectionPreference,
} from "../providers/connection";

/** Per-agent bağlantı modu tercihini SQLite'da saklar (PRD §9.5). */
export class AgentSettingsRepository {
  constructor(private readonly db: DB) {}

  getPreference(workspaceId: string, role: AgentRole): ConnectionPreference {
    const row = this.db
      .prepare(
        "SELECT connection_preference FROM agent_settings WHERE workspace_id = ? AND role = ?",
      )
      .get(workspaceId, role) as { connection_preference: string } | undefined;
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
}

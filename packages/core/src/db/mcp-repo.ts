import { randomUUID } from "node:crypto";
import type { DB } from "./connection";

export interface McpServerRecord {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface CreateMcpServerInput {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface McpServerRow {
  id: string;
  name: string;
  command: string;
  args: string;
  env: string;
  enabled: number;
}

function toRecord(row: McpServerRow): McpServerRecord {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    args: JSON.parse(row.args),
    env: JSON.parse(row.env),
    enabled: row.enabled === 1,
  };
}

export class McpRepository {
  constructor(private readonly db: DB) {}

  create(input: CreateMcpServerInput): McpServerRecord {
    const record: McpServerRecord = {
      id: randomUUID(),
      name: input.name,
      command: input.command,
      args: input.args,
      env: input.env,
      enabled: true,
    };
    this.db
      .prepare(
        "INSERT INTO mcp_servers (id, name, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.name,
        record.command,
        JSON.stringify(record.args),
        JSON.stringify(record.env),
        record.enabled ? 1 : 0,
      );
    return record;
  }

  list(): McpServerRecord[] {
    const rows = this.db.prepare("SELECT * FROM mcp_servers").all() as McpServerRow[];
    return rows.map(toRecord);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
  }

  toggle(id: string, enabled: boolean): void {
    this.db.prepare("UPDATE mcp_servers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  }

  getByName(name: string): McpServerRecord | null {
    const row = this.db.prepare("SELECT * FROM mcp_servers WHERE name = ?").get(name) as
      | McpServerRow
      | undefined;
    return row ? toRecord(row) : null;
  }
}

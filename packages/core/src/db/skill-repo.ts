import { randomUUID } from "node:crypto";
import type { DB } from "./connection";

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  prompt: string;
  createdAt: string;
}

export interface CreateSkillInput {
  name: string;
  description: string;
  prompt: string;
}

interface SkillRow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  created_at: string;
}

function toRecord(row: SkillRow): SkillRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    createdAt: row.created_at,
  };
}

export class SkillRepository {
  constructor(private readonly db: DB) {}

  create(input: CreateSkillInput): SkillRecord {
    const record: SkillRecord = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO skills (id, name, description, prompt, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(record.id, record.name, record.description, record.prompt, record.createdAt);
    return record;
  }

  list(): SkillRecord[] {
    const rows = this.db.prepare("SELECT * FROM skills ORDER BY name ASC").all() as SkillRow[];
    return rows.map(toRecord);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM skills WHERE id = ?").run(id);
  }

  getByName(name: string): SkillRecord | null {
    const row = this.db.prepare("SELECT * FROM skills WHERE name = ?").get(name) as
      | SkillRow
      | undefined;
    return row ? toRecord(row) : null;
  }
}

import { randomUUID } from "node:crypto";
import type { DB } from "./connection";
import type { Workspace } from "../domain/workspace";

export interface CreateWorkspaceInput {
  name: string;
  repoPath: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  repo_path: string;
  created_at: string;
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repo_path,
    createdAt: row.created_at,
  };
}

/** Workspace CRUD — yerel SQLite üzerinden (PRD §14). */
export class WorkspaceRepository {
  constructor(private readonly db: DB) {}

  create(input: CreateWorkspaceInput): Workspace {
    const workspace: Workspace = {
      id: randomUUID(),
      name: input.name,
      repoPath: input.repoPath,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO workspaces (id, name, repo_path, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(workspace.id, workspace.name, workspace.repoPath, workspace.createdAt);
    return workspace;
  }

  getById(id: string): Workspace | null {
    const row = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as
      | WorkspaceRow
      | undefined;
    return row ? toWorkspace(row) : null;
  }

  list(): Workspace[] {
    const rows = this.db
      .prepare("SELECT * FROM workspaces ORDER BY created_at DESC")
      .all() as WorkspaceRow[];
    return rows.map(toWorkspace);
  }
}

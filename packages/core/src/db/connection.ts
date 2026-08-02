import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";

export type DB = Database.Database;

/** Adds the column when it is missing (idempotent, backwards compatible). */
function ensureColumn(db: DB, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Versioned, **forward-only** and idempotent migrations.
 *
 * Each step runs exactly once and advances the `user_version` pragma. No step deletes data:
 * when status words change, old values are mapped onto the new ones rather than dropped.
 */
const MIGRATIONS: ReadonlyArray<(db: DB) => void> = [
  // 1: per-agent model selection by the user.
  (db) => {
    ensureColumn(db, "agent_settings", "model_provider", "TEXT");
    ensureColumn(db, "agent_settings", "model_id", "TEXT");
  },

  // 2: orchestration engine: the task record now carries the engine lifecycle.
  (db) => {
    ensureColumn(db, "tasks", "prompt", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "tasks", "execution_mode", "TEXT NOT NULL DEFAULT 'auto'");
    ensureColumn(db, "tasks", "working_dir", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "tasks", "kind", "TEXT NOT NULL DEFAULT 'task'");
    ensureColumn(db, "tasks", "parent_task_id", "TEXT");
    ensureColumn(db, "tasks", "schedule_id", "TEXT");
    ensureColumn(db, "tasks", "plan_hash", "TEXT");
    ensureColumn(db, "tasks", "delivery", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "tasks", "verification", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "tasks", "remaining_risk", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "tasks", "rounds", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "tasks", "delegations", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "tasks", "calls", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "tasks", "usd_cost", "REAL NOT NULL DEFAULT 0");
    ensureColumn(db, "tasks", "changed_files", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "tasks", "started_at", "TEXT");

    // Map the old Kanban status words onto the engine vocabulary (no data loss).
    db.exec(`
      UPDATE tasks SET status = 'pending' WHERE status = 'backlog';
      UPDATE tasks SET status = 'running' WHERE status IN ('in_progress', 'review');
      UPDATE tasks SET prompt = title WHERE prompt = '';
    `);
  },
];

/** Schema version: equal to the length of `MIGRATIONS`. */
export const SCHEMA_VERSION = MIGRATIONS.length;

function applyMigrations(db: DB): void {
  const current = Number((db.pragma("user_version", { simple: true }) as number | undefined) ?? 0);
  for (let version = current; version < MIGRATIONS.length; version++) {
    const migrate = MIGRATIONS[version];
    if (migrate === undefined) continue;
    db.transaction(() => {
      migrate(db);
      db.pragma(`user_version = ${String(version + 1)}`);
    })();
  }
}

/**
 * Opens the SQLite database, sets the pragmas and applies the schema idempotently.
 * `:memory:` can be used in tests.
 */
export function openDatabase(filename: string): DB {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  applyMigrations(db);
  return db;
}

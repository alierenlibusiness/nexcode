import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";

export type DB = Database.Database;

/** Sütun yoksa ekler (idempotent, geriye dönük uyumlu). */
function ensureColumn(db: DB, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Sürümlü, **ileri-only** ve idempotent migration'lar.
 *
 * Her adım yalnızca bir kez çalışır; `user_version` pragması ilerletilir. Hiçbir adım veri
 * silmez — durum sözcükleri değişirse eski değerler yenilerine eşlenir, satırlar atılmaz.
 */
const MIGRATIONS: ReadonlyArray<(db: DB) => void> = [
  // 1 — Faz 2: kullanıcının agent başına model seçimi (PRD §9.5).
  (db) => {
    ensureColumn(db, "agent_settings", "model_provider", "TEXT");
    ensureColumn(db, "agent_settings", "model_id", "TEXT");
  },

  // 2 — Orkestrasyon motoru: görev kaydı motorun yaşam döngüsünü taşır.
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

    // Eski Kanban durum sözcüklerini motor sözlüğüne eşle (veri kaybı yok).
    db.exec(`
      UPDATE tasks SET status = 'pending' WHERE status = 'backlog';
      UPDATE tasks SET status = 'running' WHERE status IN ('in_progress', 'review');
      UPDATE tasks SET prompt = title WHERE prompt = '';
    `);
  },
];

/** Şema sürümü — `MIGRATIONS` uzunluğu ile eşittir. */
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
 * SQLite veritabanını açar, pragmaları ayarlar ve şemayı (idempotent) uygular.
 * `:memory:` testlerde kullanılabilir.
 */
export function openDatabase(filename: string): DB {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  applyMigrations(db);
  return db;
}

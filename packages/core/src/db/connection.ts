import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";

export type DB = Database.Database;

/** Sütun yoksa ekler (önceden oluşturulmuş DB'ler için hafif, idempotent migration). */
function ensureColumn(db: DB, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Şema oluşturulduktan sonra geriye dönük uyumlu sütun eklemeleri (Faz 2). */
function applyMigrations(db: DB): void {
  // Faz 2: kullanıcının agent başına model seçimi (PRD §9.5).
  ensureColumn(db, "agent_settings", "model_provider", "TEXT");
  ensureColumn(db, "agent_settings", "model_id", "TEXT");
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

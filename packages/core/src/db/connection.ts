import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";

export type DB = Database.Database;

/**
 * SQLite veritabanını açar, pragmaları ayarlar ve şemayı (idempotent) uygular.
 * `:memory:` testlerde kullanılabilir.
 */
export function openDatabase(filename: string): DB {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

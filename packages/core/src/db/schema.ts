/**
 * Yerel-öncelikli SQLite şeması (PRD §14).
 *
 * Tüm tablolar `IF NOT EXISTS` ile idempotent oluşturulur; sütun eklemeleri
 * `connection.ts` içindeki sürümlü, ileri-only migration'larla yapılır.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  repo_path   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  model_provider  TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  connection_mode TEXT NOT NULL,
  status          TEXT NOT NULL,
  autonomy_level  TEXT NOT NULL
);

-- Görev kuyruğu. Motor durumları: pending · approval · running · done · failed · blocked.
CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT REFERENCES agents(id) ON DELETE SET NULL,
  assigned_role  TEXT,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL,
  priority       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  completed_at   TEXT
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id            TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action_type  TEXT NOT NULL,
  status       TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  resolved_at  TEXT,
  resolved_by  TEXT
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
  content      TEXT NOT NULL,
  embedding    BLOB,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS git_events (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
  commit_hash  TEXT NOT NULL,
  branch       TEXT NOT NULL,
  message      TEXT NOT NULL,
  is_human     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cost_logs (
  id                   TEXT PRIMARY KEY,
  agent_id             TEXT REFERENCES agents(id) ON DELETE SET NULL,
  task_id              TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  provider             TEXT NOT NULL,
  model_id             TEXT NOT NULL,
  connection_mode      TEXT NOT NULL,
  input_tokens         INTEGER NOT NULL DEFAULT 0,
  output_tokens        INTEGER NOT NULL DEFAULT 0,
  usd_cost             REAL NOT NULL DEFAULT 0,
  subscription_pool_id TEXT
);

CREATE TABLE IF NOT EXISTS agent_settings (
  workspace_id          TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role                  TEXT NOT NULL,
  connection_preference TEXT NOT NULL DEFAULT 'cli_first',
  -- Kullanıcının agent için seçtiği model (NULL = agent varsayılanı, PRD §7/§8 + §9.5):
  model_provider        TEXT,
  model_id              TEXT,
  PRIMARY KEY (workspace_id, role)
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  command     TEXT NOT NULL,
  args        TEXT NOT NULL,
  env         TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS skills (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- ── Orkestrasyon motoru ─────────────────────────────────────────────────────

-- Kalıcı olay geçmişi. Sayfa açılışındaki replay bu tablodan beslenir; \`seq\`
-- canlı akışla ortak olduğundan tamponlanan olaylar tekilleştirilebilir.
CREATE TABLE IF NOT EXISTS task_events (
  seq        INTEGER PRIMARY KEY,
  task_id    TEXT,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  ts         TEXT NOT NULL
);

-- Tur ve atama kaydı — Ekip Akışı zaman çizelgesi ve teslimat özeti bunları okur.
CREATE TABLE IF NOT EXISTS task_rounds (
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  round       INTEGER NOT NULL,
  phase       TEXT NOT NULL,
  plan_summary TEXT NOT NULL DEFAULT '',
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  PRIMARY KEY (task_id, round)
);

CREATE TABLE IF NOT EXISTS task_assignments (
  id           TEXT NOT NULL,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  round        INTEGER NOT NULL,
  agent_id     TEXT NOT NULL,
  agent_name   TEXT NOT NULL,
  adapter      TEXT,
  kind         TEXT NOT NULL,
  role         TEXT NOT NULL,
  instruction  TEXT NOT NULL,
  depends_on   TEXT NOT NULL DEFAULT '[]',
  skills       TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL,
  verdict      TEXT,
  output       TEXT NOT NULL DEFAULT '',
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, id)
);

-- Tamamlanmış görev hakkındaki salt-okunur operatör sohbeti.
CREATE TABLE IF NOT EXISTS task_conversation (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Görev öncesi sürümleme. \`kind\` = pre | redo; redo, geri almanın geri alınmasını sağlar.
CREATE TABLE IF NOT EXISTS checkpoints (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  working_dir TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  file_count  INTEGER NOT NULL DEFAULT 0
);

-- İçeriği güvenle saklanamayan dosyalarda (ikili, hassas, sınır aşan) content NULL olur
-- ve geri yüklemede o dosyaya dokunulmaz.
CREATE TABLE IF NOT EXISTS checkpoint_files (
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  content       TEXT,
  PRIMARY KEY (checkpoint_id, path)
);

CREATE TABLE IF NOT EXISTS schedules (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Motor durumu ve sayaçlar (tek satır anahtar/değer).
CREATE TABLE IF NOT EXISTS engine_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Sürümlü CLI sağlık önbelleği; sözleşme sürümü değişince kayıtlar geçersizleşir.
CREATE TABLE IF NOT EXISTS cli_health (
  agent_id         TEXT PRIMARY KEY,
  status           TEXT NOT NULL,
  detail           TEXT NOT NULL DEFAULT '',
  checked_at       TEXT NOT NULL,
  contract_version INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_memory_workspace ON memory_entries(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cost_logs_pool ON cost_logs(subscription_pool_id);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, seq);
CREATE INDEX IF NOT EXISTS idx_task_assignments_task ON task_assignments(task_id, round);
CREATE INDEX IF NOT EXISTS idx_checkpoints_dir ON checkpoints(working_dir, created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_task ON task_conversation(task_id, created_at);
`;

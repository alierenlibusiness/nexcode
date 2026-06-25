/**
 * Yerel-öncelikli SQLite şeması (PRD §14).
 * Tüm tablolar `IF NOT EXISTS` ile idempotent oluşturulur.
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

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  completed_at TEXT
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

CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_workspace ON memory_entries(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cost_logs_pool ON cost_logs(subscription_pool_id);
`;

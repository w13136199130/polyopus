-- v1.1 agent-level default subagents (single level).
-- docs/31 planned agent_subagents without tenant isolation; the runtime adds
-- tenant_id so one instance cannot reference another tenant's experts.

CREATE TABLE IF NOT EXISTS agent_subagents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  subagent_id   TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  config_json   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, agent_id, subagent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_subagents
  ON agent_subagents(tenant_id, agent_id, enabled);

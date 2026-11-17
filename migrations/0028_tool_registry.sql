-- V1-12 tool registry + per-agent settings (docs/31 §3.6).
-- Builtin rows are materialized by domains/tools/service.py; this migration
-- owns the stable schema and the FK from settings to the registry.

CREATE TABLE tools (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_key      TEXT NOT NULL UNIQUE,
  source        TEXT NOT NULL,
  version       TEXT NOT NULL,
  spec_json     TEXT NOT NULL,
  enabled_global INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE tool_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  tool_key      TEXT NOT NULL REFERENCES tools(tool_key),
  enabled       INTEGER NOT NULL DEFAULT 1,
  config_json   TEXT,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, agent_id, tool_key)
);
CREATE INDEX idx_tool_settings_agent ON tool_settings(tenant_id, agent_id);

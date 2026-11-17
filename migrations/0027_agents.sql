-- V1-11 experts: agents, immutable published versions and prompt files.
-- Drafts live in agent_versions at version=0; published versions are immutable.

CREATE TABLE agents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  agent_id      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  avatar        TEXT,
  model         TEXT,
  backend       TEXT NOT NULL DEFAULT 'builtin',
  status        TEXT NOT NULL DEFAULT 'draft',
  visibility    TEXT NOT NULL DEFAULT 'private',
  draft_version INTEGER NOT NULL DEFAULT 0,
  published_version INTEGER,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, name)
);
CREATE INDEX idx_agents_tenant ON agents(tenant_id, deleted_at, updated_at DESC);

CREATE TABLE agent_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  version       INTEGER NOT NULL,
  config_json   TEXT NOT NULL,
  files_json    TEXT,
  published_by  TEXT,
  published_at  INTEGER NOT NULL,
  is_current    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (agent_id, version)
);
CREATE UNIQUE INDEX uq_agent_current ON agent_versions(agent_id)
  WHERE is_current = 1;

CREATE TABLE agent_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  content       TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (agent_id, name)
);

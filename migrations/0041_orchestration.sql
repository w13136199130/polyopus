-- v1.1 orchestration slice 1: teams and member rosters (docs/31 §3.2).
-- Delegations (派工) land in the next slice together with the coordinator loop.

CREATE TABLE IF NOT EXISTS teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  team_id       TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  routing_json  TEXT,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS team_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  team_id       TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member', -- lead|member
  created_at    INTEGER NOT NULL,
  UNIQUE (team_id, agent_id)
);

-- V1-14 connectors: catalog, per-tenant instances, OAuth state, bindings.
-- Credentials are encrypted in config_enc; the API never returns them.

CREATE TABLE connector_catalog (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_id    TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  auth_kind     TEXT NOT NULL,
  config_json   TEXT
);

CREATE TABLE connector_instances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  instance_id   TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  config_enc    TEXT,
  auth_kind     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  owner_id      TEXT NOT NULL,
  shared        INTEGER NOT NULL DEFAULT 0,
  default_open  INTEGER NOT NULL DEFAULT 0,
  tools_count   INTEGER NOT NULL DEFAULT 0,
  last_probe_at INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, owner_id, display_name)
);
CREATE INDEX idx_connector_instances ON connector_instances(tenant_id, status, updated_at DESC);

CREATE TABLE connector_oauth_states (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  state_id      TEXT NOT NULL UNIQUE,
  connector_kind TEXT NOT NULL,
  instance_id   TEXT,
  status        TEXT NOT NULL,
  authorize_url TEXT,
  verifier_enc  TEXT,
  user_code     TEXT,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER
);
CREATE INDEX idx_oauth_pending ON connector_oauth_states(tenant_id, status, expires_at);

CREATE TABLE connector_bindings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  connector_instance_id TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  config_json   TEXT,
  UNIQUE (connector_instance_id, agent_id)
);

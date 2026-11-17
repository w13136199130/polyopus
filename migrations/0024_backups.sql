-- V1-07 backup/restore (docs/31 §3.11).
-- `backups` is instance-level (tenant_id='system'); auto settings live in
-- `backup_settings` keyed by the same system tenant.

CREATE TABLE backups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_id     TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,
  storage_ref   TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  checksum      TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  auto          INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  restored_at   INTEGER
);
CREATE TABLE backup_settings (
  tenant_id     TEXT PRIMARY KEY,
  auto_enabled  INTEGER NOT NULL DEFAULT 0,
  interval_hours INTEGER NOT NULL DEFAULT 24,
  retention_count INTEGER NOT NULL DEFAULT 7,
  includes_json TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_backups_time ON backups(tenant_id, created_at DESC);

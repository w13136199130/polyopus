-- V1-03 auth hardening: API keys, MFA, refresh rotation + step-up.
-- api_keys/user_mfa DDL verbatim from docs/31; the three session columns
-- extend the M0 sessions table for rotation families and step-up.

ALTER TABLE sessions ADD COLUMN family_id TEXT;
ALTER TABLE sessions ADD COLUMN used_at INTEGER;
ALTER TABLE sessions ADD COLUMN step_up_until INTEGER;

CREATE TABLE api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL UNIQUE,
  key_hash      TEXT NOT NULL,
  scopes_json   TEXT NOT NULL,
  last_used_at  INTEGER,
  expires_at    INTEGER,
  revoked_at    INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_apikey_user ON api_keys(tenant_id, user_id, revoked_at);

CREATE TABLE user_mfa (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             TEXT NOT NULL,
  method              TEXT NOT NULL,          -- totp|webauthn
  credential_id       TEXT NOT NULL DEFAULT '',
  secret_enc          TEXT,
  credential_json     TEXT,
  recovery_codes_enc  TEXT,
  enabled             INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  last_used_at        INTEGER,
  UNIQUE (user_id, method, credential_id)
);

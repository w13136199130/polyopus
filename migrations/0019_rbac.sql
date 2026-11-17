-- V1-02 RBAC: builtin roles per tenant + user assignments.
-- DDL verbatim from docs/31 §3.10; no seed rows (roles are lazily
-- materialized per tenant on login/user creation).
CREATE TABLE roles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id         TEXT NOT NULL UNIQUE,
  tenant_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  builtin         INTEGER NOT NULL DEFAULT 0,
  permissions_json TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE user_roles (
  user_id       TEXT NOT NULL,
  role_id       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);

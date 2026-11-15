-- V05-19 audit & replay: append-only audit log (docs/31 §3.7).
-- No update/delete paths; the API is read-only.

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  audit_id      TEXT NOT NULL UNIQUE,
  actor_id      TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  result        TEXT NOT NULL, -- ok|denied|failed
  detail_json   TEXT,
  ip            TEXT,
  trace_id      TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_audit_time ON audit_log(tenant_id, created_at DESC);

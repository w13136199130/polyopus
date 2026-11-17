-- V1-06 audit compliance: export/purge jobs (docs/31 §3.11).
-- A job is the authority for "export first, then anonymize, then purge".

CREATE TABLE data_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT,
  kind          TEXT NOT NULL,             -- export|delete
  scope_json    TEXT NOT NULL,             -- tenant/user/thread/kb...
  status        TEXT NOT NULL,             -- queued|running|ready|failed|done
  progress      REAL NOT NULL DEFAULT 0,
  storage_ref   TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER
);
CREATE INDEX idx_data_jobs ON data_jobs(tenant_id, kind, status, created_at DESC);

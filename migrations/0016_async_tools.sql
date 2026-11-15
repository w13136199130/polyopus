-- V05-17 async tools: the authoritative tool audit table plus artifacts.
-- DDL copied from docs/31 (tool_calls / artifacts); these tables were in the
-- first-version inventory but had no migration yet.

CREATE TABLE tool_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_call_id  TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  turn_id       TEXT NOT NULL,
  run_id        TEXT,
  tool_key      TEXT NOT NULL,
  args_json     TEXT NOT NULL,
  result_json   TEXT,
  status        TEXT NOT NULL,               -- running|completed|failed|denied
  risk          TEXT NOT NULL,
  approval_id   TEXT,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  error_code    TEXT
);
CREATE INDEX idx_toolcall_turn ON tool_calls(tenant_id, turn_id, started_at);

CREATE TABLE artifacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id   TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  thread_id     TEXT,
  turn_id       TEXT,
  run_id        TEXT,
  kind          TEXT NOT NULL,               -- file|image|pdf|pr|diff|report|link
  ref           TEXT NOT NULL,               -- storage ref / URL
  mime          TEXT,
  size          INTEGER,
  sha256        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_artifact_scope ON artifacts(tenant_id, thread_id, turn_id);

-- v1.1 orchestration slice 2: delegations (docs/31 §3.2).
-- One row per member dispatch; `(tenant_id, dedupe_key)` makes retries
-- idempotent, `lease_until/last_heartbeat_at` guard the in-flight claim.

CREATE TABLE IF NOT EXISTS delegations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  team_id       TEXT NOT NULL REFERENCES teams(team_id),
  parent_ticket_id TEXT,
  parent_run_id TEXT NOT NULL,
  member_agent_id TEXT NOT NULL,
  child_thread_id TEXT,
  dedupe_key    TEXT NOT NULL,             -- hash(parent_run_id+member_id+task_id)
  state         TEXT NOT NULL,             -- pending|running|ended|dead
  payload_json  TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  lease_until   INTEGER,
  last_heartbeat_at INTEGER,
  next_retry_at INTEGER,
  created_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_deleg_state
  ON delegations(tenant_id, state, created_at);
CREATE INDEX IF NOT EXISTS idx_deleg_lease
  ON delegations(state, lease_until);

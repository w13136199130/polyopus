-- v1.1 subagent delegation checkpoint: pause the parent turn when a child
-- write needs approval, then resume the child from the pending tool call.

CREATE TABLE IF NOT EXISTS subagent_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id   TEXT NOT NULL UNIQUE,
  tenant_id       TEXT NOT NULL,
  thread_id       TEXT NOT NULL,
  parent_turn_id  TEXT NOT NULL,
  parent_run_id   TEXT NOT NULL,
  parent_call_id  TEXT NOT NULL,
  parent_args_json TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  agent_name      TEXT NOT NULL,
  child_model     TEXT NOT NULL,
  task            TEXT NOT NULL,
  parent_user     TEXT NOT NULL,
  messages_json   TEXT NOT NULL,
  pending_json    TEXT,
  usage_json      TEXT NOT NULL,
  tools_json      TEXT NOT NULL DEFAULT '[]',
  rounds          INTEGER NOT NULL DEFAULT 0,
  approval_id     TEXT,
  status          TEXT NOT NULL,  -- waiting_approval|completed|failed
  ticket_id       TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subagent_runs_turn
  ON subagent_runs(tenant_id, parent_turn_id, status);
CREATE INDEX IF NOT EXISTS idx_subagent_runs_approval
  ON subagent_runs(approval_id);

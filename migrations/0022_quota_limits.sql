-- V1-05 quota limits (docs/31 §3.11). scope = tenant|user|model;
-- metric = tokens|cost|requests; window = day|month|absolute; 0 = unlimited.
CREATE TABLE quota_limits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  quota_id      TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  scope         TEXT NOT NULL,
  scope_id      TEXT NOT NULL,
  metric        TEXT NOT NULL,
  limit_value   INTEGER NOT NULL,
  window        TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, scope, scope_id, metric, window)
);

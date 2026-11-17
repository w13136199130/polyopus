-- V1-10 in-app notifications (docs/31 §3.7). Dedupe key makes inserts
-- idempotent inside an aggregation window; no IM delivery in v1.0.

CREATE TABLE notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id TEXT NOT NULL UNIQUE,
  tenant_id       TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  kind            TEXT NOT NULL,             -- task|cloud|export|system
  title           TEXT NOT NULL,
  body            TEXT,
  link            TEXT,
  dedupe_key      TEXT NOT NULL,
  read_at         INTEGER,
  created_at      INTEGER NOT NULL,
  UNIQUE (tenant_id, user_id, dedupe_key)
);
CREATE INDEX idx_notif_unread ON notifications(tenant_id, user_id, read_at, created_at DESC);

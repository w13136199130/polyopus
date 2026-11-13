-- 0014 (V05-10): subscription fan-out. DDL verbatim docs/31 §3.8
-- (tenant_id added per the business-table rule, docs/31 updated in the
-- same change; manifest re-emitted). Hand-written like 0011-0013 so
-- applied-migration checksums stay stable. Release is by row deletion —
-- the fan-out lookup joins tickets.state='open', so a missed delete can
-- never permanently swallow new tickets for the thread.

CREATE TABLE subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  subscription_id TEXT NOT NULL UNIQUE,
  ticket_id     TEXT NOT NULL REFERENCES tickets(ticket_id),
  event_thread_id TEXT NOT NULL,
  filter_json   TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (ticket_id, event_thread_id)
);

CREATE INDEX idx_subscriptions_thread
  ON subscriptions(tenant_id, event_thread_id);

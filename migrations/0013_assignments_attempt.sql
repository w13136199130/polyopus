-- 0013 (V05-07): ticket auto-execution needs a claim semaphore.
-- attempt is a per-ticket monotonic counter; UNIQUE(tenant, ticket, attempt)
-- arbitrates when two workers race the same queued ticket — exactly like
-- runs.UNIQUE(turn_id, attempt) does for turns.

ALTER TABLE assignments ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX idx_assignments_ticket_attempt
  ON assignments(tenant_id, ticket_id, attempt);

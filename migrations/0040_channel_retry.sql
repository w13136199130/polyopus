-- v1.1 channel outbound reliability (CHAN-003): bounded retries with backoff.
-- `attempts` counts delivery attempts; `next_retry_at` is the earliest time the
-- worker may try again. Terminal failures keep status='failed'.

ALTER TABLE channel_messages ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channel_messages ADD COLUMN next_retry_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_chmsg_retry
  ON channel_messages(direction, status, next_retry_at);

-- Inbox read/snooze state (MEM/inbox UX). Additive only.
ALTER TABLE attentions ADD COLUMN read_at INTEGER;
ALTER TABLE attentions ADD COLUMN snoozed_until INTEGER;

CREATE INDEX idx_attentions_snoozed ON attentions(tenant_id, status, snoozed_until);

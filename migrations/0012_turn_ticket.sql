-- W11 batch 4: turn ticket back-reference (ADR-012 / docs/02 §3.6.1).
-- docs/31's turns DDL omits ticket_id even though ADR-012 requires
-- back-filling it when a lazy Ticket is created; added here rather than in
-- 0001 to keep existing databases' migration checksums stable.
ALTER TABLE turns ADD COLUMN ticket_id TEXT;

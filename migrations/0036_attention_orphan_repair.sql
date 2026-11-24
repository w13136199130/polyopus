-- Repair tickets orphaned in `attention`: their approval expired (or was
-- answered) but the ticket was never closed, so the task waits forever with
-- no decision left to make. New code closes the ticket on expiry; ended
-- tickets can be re-run from the task detail.
UPDATE tickets
SET state = 'ended', bucket = 'done',
    ended_at = COALESCE(ended_at, updated_at)
WHERE state = 'open' AND bucket = 'attention'
  AND NOT EXISTS (
    SELECT 1 FROM attentions a
    WHERE a.ticket_id = tickets.ticket_id AND a.status = 'pending'
  );

-- Manual tickets created before the fs:write scope fix could never produce
-- files: the policy gate denied fs.write at the mandate layer. Writes still
-- require approval, so widening only the manual scope is safe.
UPDATE tickets
SET scope_json = '["workspace:default","fs:write"]'
WHERE source_id IS NULL AND trigger_id IS NULL
  AND scope_json = '["workspace:default"]';

UPDATE mandates
SET scope_json = '["workspace:default","fs:write"]'
WHERE ticket_id IN (
  SELECT ticket_id FROM tickets
  WHERE source_id IS NULL AND trigger_id IS NULL
    AND scope_json = '["workspace:default","fs:write"]'
);

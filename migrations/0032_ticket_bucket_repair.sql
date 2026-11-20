-- Repair rows left by the historical stop/assign race: an ended ticket must
-- never stay visible as running/queued. New code serializes stop vs assign.
UPDATE tickets SET bucket = 'done' WHERE state = 'ended' AND bucket != 'done';

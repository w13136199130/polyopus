-- Per-session composer state (prototype chat header/composer parity).
-- One JSON object per thread: model hint, enabled knowledge bases,
-- connectors, sub-agents and the tool approval policy. Kept on the thread
-- (not the user) because choices belong to the conversation, and because a
-- branched thread must inherit exactly what its parent was using.
ALTER TABLE threads ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';

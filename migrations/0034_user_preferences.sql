-- Per-user UI preferences (notification switches first; server-owned so a
-- second device sees the same settings). Existing users default to {}.
ALTER TABLE users ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '{}';

-- V1-04 user/invite management: pending invitations (docs/31 §3.1).
CREATE TABLE invites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  invite_id     TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  role_id       TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  invited_by    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|revoked|expired
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  accepted_at   INTEGER
);
CREATE UNIQUE INDEX uq_invites_pending ON invites(tenant_id, email) WHERE status = 'pending';

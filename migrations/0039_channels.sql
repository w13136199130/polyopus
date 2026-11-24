-- v1.1 channels: IM ingress/egress instances. Credentials are encrypted and
-- stored in credential_ref (never returned by the API).

CREATE TABLE IF NOT EXISTS channels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,             -- feishu|dingtalk|wecom|qq|telegram|discord
  display_name  TEXT NOT NULL,
  config_json   TEXT,                      -- app_id / source_id / non-secrets
  credential_ref TEXT,                     -- secretbox-encrypted JSON
  status        TEXT NOT NULL DEFAULT 'disabled',
  last_error    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, display_name)
);

CREATE INDEX IF NOT EXISTS idx_channels_tenant
  ON channels(tenant_id, kind, status);

CREATE TABLE IF NOT EXISTS channel_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  direction     TEXT NOT NULL,             -- inbound|outbound
  external_id   TEXT NOT NULL,
  thread_id     TEXT,
  ticket_id     TEXT,
  actor_id      TEXT,
  actor_kind    TEXT,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL,             -- received|sent|failed|ignored|duplicate
  error_code    TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (channel_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_thread
  ON channel_messages(tenant_id, thread_id, created_at);

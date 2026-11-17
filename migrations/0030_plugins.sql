-- V1-15 plugin registry: signed manifests, version pin and tool registration.
CREATE TABLE plugins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id     TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  version       TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  status        TEXT NOT NULL,
  signature     TEXT,
  installed_at  INTEGER NOT NULL
);

CREATE TABLE plugin_signatures (
  plugin_id     TEXT NOT NULL,
  version       TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  signer        TEXT,
  signed_at     INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, version)
);
CREATE INDEX idx_plugins_tenant ON plugins(tenant_id, status, installed_at DESC);

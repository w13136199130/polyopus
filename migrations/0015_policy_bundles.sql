-- 0015 (V05-12): policy versioning. DDL verbatim docs/31 §3.12/§3.8 (both
-- tables are already counted in the 94-table manifest); hand-written like
-- 0011-0014 so applied-migration checksums stay stable. A bundle is the
-- publish unit: draft -> active -> rolled_back, one active per tenant;
-- mandates pin the version they were granted under and keep executing its
-- rules_json snapshot after newer versions are published.

CREATE TABLE policy_bundles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id     TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  version       INTEGER NOT NULL,
  status        TEXT NOT NULL,             -- draft|active|rolled_back
  rules_json    TEXT NOT NULL,             -- 规则快照
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  activated_at  INTEGER,
  UNIQUE (tenant_id, version)
);
CREATE INDEX idx_policy_bundle_active ON policy_bundles(tenant_id, status, version DESC);

CREATE TABLE policy_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id       TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  bundle_id     TEXT,                      -- 来源策略包；回滚时按 bundle 切
  priority      INTEGER NOT NULL,
  when_json     TEXT NOT NULL,             -- 受限 DSL，不 eval Python
  effect        TEXT NOT NULL,             -- allow|ask|deny
  obligations_json TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  enabled       INTEGER NOT NULL DEFAULT 1,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_policy_eval ON policy_rules(tenant_id, enabled, priority DESC);

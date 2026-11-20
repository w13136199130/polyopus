-- Discovered MCP tools per connector instance (tenant-scoped).
-- The model-visible wire name is stored because MCP names are arbitrary and
-- OpenAI function names must be [a-zA-Z0-9_-].
CREATE TABLE connector_tools (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT NOT NULL,
  instance_id       TEXT NOT NULL,
  server            TEXT NOT NULL,
  tool_name         TEXT NOT NULL,
  wire_name         TEXT NOT NULL,
  tool_key          TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  enabled           INTEGER NOT NULL DEFAULT 1,
  discovered_at     INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (tenant_id, instance_id, server, tool_name)
);
CREATE INDEX idx_connector_tools_instance
  ON connector_tools(tenant_id, instance_id);

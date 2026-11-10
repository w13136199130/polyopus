-- M0-09: default tenant. Idempotent; safe to re-run.
INSERT INTO tenants (tenant_id, name, status, plan, created_at, updated_at)
SELECT 'default', 'Default', 'active', 'free',
       CAST(strftime('%s', 'now') AS INTEGER),
       CAST(strftime('%s', 'now') AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE tenant_id = 'default');

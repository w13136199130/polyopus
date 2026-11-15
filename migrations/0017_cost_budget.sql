-- V05-18 cost & budget: seed the default model price + per-ticket lookup.
-- Prices are CNY per million tokens; they are versioned, so future changes
-- must insert a new version and never rewrite historical ledger rows.

INSERT INTO model_prices
  (model, currency, input_per_mtok, output_per_mtok, cached_per_mtok,
   version, effective_from, created_at)
SELECT 'deepseek-flash', 'CNY', 2.0, 8.0, 0.2, 1,
       CAST(strftime('%s', 'now') AS INTEGER),
       CAST(strftime('%s', 'now') AS INTEGER)
WHERE NOT EXISTS (
  SELECT 1 FROM model_prices WHERE model = 'deepseek-flash' AND version = 1
);

-- ticket cost rollup queries scan by ticket; source/day joins through it.
CREATE INDEX idx_usage_ticket ON usage_ledger(tenant_id, ticket_id);

-- W11 batch 3: model pricing + ledger currency/version columns.
-- Hand-written (like 0002_seed): model_prices DDL is verbatim docs/31 §2.4;
-- the two ALTERs extend usage_ledger (docs/02 §5.1: bills keep the
-- price_version they were charged under). Not folded into 0001 to keep
-- existing databases' migration checksums stable.
CREATE TABLE model_prices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  model         TEXT NOT NULL,
  currency      TEXT NOT NULL,             -- CNY|USD
  input_per_mtok  REAL NOT NULL,
  output_per_mtok REAL NOT NULL,
  cached_per_mtok REAL NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL,
  effective_from INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (model, version, effective_from)
);
ALTER TABLE usage_ledger ADD COLUMN currency TEXT;
ALTER TABLE usage_ledger ADD COLUMN price_version TEXT;

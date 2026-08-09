-- Run once in Supabase before deploying scalp-v2.0.0.
-- Stable Binance identifiers let the scalp process reconcile one trade
-- without cancelling manual orders or another trade on the same symbol.

ALTER TABLE scalp_trade_logs
  ADD COLUMN IF NOT EXISTS ownership_token TEXT,
  ADD COLUMN IF NOT EXISTS entry_order_id BIGINT,
  ADD COLUMN IF NOT EXISTS entry_client_order_id TEXT,
  ADD COLUMN IF NOT EXISTS sl_algo_id BIGINT,
  ADD COLUMN IF NOT EXISTS tp_algo_id BIGINT,
  ADD COLUMN IF NOT EXISTS sl_client_algo_id TEXT,
  ADD COLUMN IF NOT EXISTS tp_client_algo_id TEXT,
  ADD COLUMN IF NOT EXISTS filled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_entry NUMERIC,
  ADD COLUMN IF NOT EXISTS realized_pnl_gross_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS commission_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS funding_fee_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS pnl_attribution TEXT,
  ADD COLUMN IF NOT EXISTS atr_rank NUMERIC,
  ADD COLUMN IF NOT EXISTS gate_diagnostics JSONB;

CREATE INDEX IF NOT EXISTS idx_scalp_ownership_token
  ON scalp_trade_logs(ownership_token);

CREATE INDEX IF NOT EXISTS idx_scalp_entry_order_id
  ON scalp_trade_logs(entry_order_id);

CREATE INDEX IF NOT EXISTS idx_scalp_sl_algo_id
  ON scalp_trade_logs(sl_algo_id);

CREATE INDEX IF NOT EXISTS idx_scalp_tp_algo_id
  ON scalp_trade_logs(tp_algo_id);

-- BBW rank is a continuous percentile in [0, 100]. Older table creation SQL
-- declared it as INTEGER, which rejects real values such as
-- 11.650485436893204. INTEGER -> NUMERIC preserves all existing rows and lets
-- the engine persist the unrounded observation used by its gates.
--
-- Optional preflight/dry-run:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'scalp_trade_logs'
--   AND column_name = 'bbw_rank';
ALTER TABLE scalp_trade_logs
  ALTER COLUMN bbw_rank TYPE NUMERIC
  USING bbw_rank::NUMERIC;

-- Missing observations remain NULL. They must not masquerade as neutral
-- measurements in later optimization.
ALTER TABLE scalp_trade_logs
  ALTER COLUMN adx DROP DEFAULT,
  ALTER COLUMN atr DROP DEFAULT,
  ALTER COLUMN rsi DROP DEFAULT,
  ALTER COLUMN cmf DROP DEFAULT,
  ALTER COLUMN bbw_rank DROP DEFAULT,
  ALTER COLUMN oi_delta DROP DEFAULT,
  ALTER COLUMN funding_rate DROP DEFAULT,
  ALTER COLUMN funding_slope DROP DEFAULT,
  ALTER COLUMN taker_ratio DROP DEFAULT,
  ALTER COLUMN btc_dom_slope DROP DEFAULT,
  ALTER COLUMN mvrv DROP DEFAULT,
  ALTER COLUMN fgi DROP DEFAULT,
  ALTER COLUMN vpin DROP DEFAULT,
  ALTER COLUMN obi DROP DEFAULT,
  ALTER COLUMN amihud DROP DEFAULT,
  ALTER COLUMN isi DROP DEFAULT,
  ALTER COLUMN cvd_trend DROP DEFAULT,
  ALTER COLUMN vwap DROP DEFAULT,
  ALTER COLUMN vwap_upper DROP DEFAULT,
  ALTER COLUMN vwap_lower DROP DEFAULT,
  ALTER COLUMN hurst_value DROP DEFAULT,
  ALTER COLUMN liq_longs_vol DROP DEFAULT,
  ALTER COLUMN liq_shorts_vol DROP DEFAULT,
  ALTER COLUMN true_ev DROP DEFAULT,
  ALTER COLUMN kelly_pct DROP DEFAULT;

-- Refresh PostgREST immediately so the daemon does not keep the old column
-- cache after this additive migration.
NOTIFY pgrst, 'reload schema';

-- Validation (expect 15 rows):
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'scalp_trade_logs'
--   AND column_name IN (
--     'ownership_token', 'entry_order_id', 'entry_client_order_id',
--     'sl_algo_id', 'tp_algo_id', 'sl_client_algo_id', 'tp_client_algo_id',
--     'filled_at', 'actual_entry', 'realized_pnl_gross_usd',
--     'commission_usd', 'funding_fee_usd', 'pnl_attribution', 'atr_rank',
--     'gate_diagnostics'
--   )
-- ORDER BY column_name;
--
-- Validate the corrected BBW contract (expect data_type = 'numeric'):
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'scalp_trade_logs'
--   AND column_name = 'bbw_rank';
--
-- Forward recovery: all added columns are nullable, so older bot versions
-- continue to work. NUMERIC also accepts every previous INTEGER value. Do not
-- drop populated ownership columns or narrow bbw_rank during rollback; redeploy
-- the previous daemon and retain the widened column instead.

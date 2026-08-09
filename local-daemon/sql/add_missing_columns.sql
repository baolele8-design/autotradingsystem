-- Chạy SQL này trong Supabase SQL Editor để thêm cột btc_regime_at_entry
-- vào bảng trade_logs và scalp_trade_logs

ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS btc_regime_at_entry TEXT;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS btc_regime TEXT;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS carbon_cluster TEXT;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS anti_fragile_tier TEXT;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS meta_prompt_time_ms INTEGER;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS reasoning_prompt_tokens INTEGER;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS reasoning_completion_tokens INTEGER;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS pattern TEXT;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS scenario TEXT;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS regime_at_entry TEXT;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS initial_sl NUMERIC;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS initial_risk_per_coin NUMERIC;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS protection_stage TEXT;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS high_water_price NUMERIC;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS high_water_r NUMERIC;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS close_price NUMERIC;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS close_time TIMESTAMPTZ;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS exit_reason TEXT;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS pee_analyzed BOOLEAN DEFAULT FALSE;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS pee_mfe_usd NUMERIC;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS pee_mae_usd NUMERIC;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS pee_mfe_candles INTEGER;
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS pee_mae_candles INTEGER;

ALTER TABLE scalp_trade_logs ADD COLUMN IF NOT EXISTS btc_regime_at_entry TEXT;
ALTER TABLE scalp_trade_logs ADD COLUMN IF NOT EXISTS btc_regime TEXT;
ALTER TABLE scalp_trade_logs ADD COLUMN IF NOT EXISTS regime_at_entry TEXT;
ALTER TABLE scalp_trade_logs ADD COLUMN IF NOT EXISTS close_price NUMERIC;
ALTER TABLE scalp_trade_logs ADD COLUMN IF NOT EXISTS close_time TIMESTAMPTZ;

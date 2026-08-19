-- Chạy SQL này trong Supabase SQL Editor để thêm cột btc_regime_at_entry
-- vào bảng trade_logs

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
ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS oi_spike BOOLEAN;

-- 2026-08-19: PEE window gio co dinh 2-3 nen theo khung lenh (directive owner).
-- Mo rong CHECK bound tu [6,24] xuong [2,24] de cho phep pee_window_candles=3.
ALTER TABLE trade_logs DROP CONSTRAINT IF EXISTS trade_logs_pee_window_candles_bounded;
ALTER TABLE trade_logs ADD CONSTRAINT trade_logs_pee_window_candles_bounded CHECK ((pee_window_candles IS NULL) OR (pee_window_candles >= 2 AND pee_window_candles <= 24));

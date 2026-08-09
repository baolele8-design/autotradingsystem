-- Chạy SQL này trong Supabase SQL Editor để tạo bảng scalp_trade_logs
-- Cấu trúc giống trade_logs, dành riêng cho Scalp Bot

CREATE TABLE IF NOT EXISTS scalp_trade_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  symbol TEXT NOT NULL,
  interval TEXT NOT NULL DEFAULT '5m',
  type TEXT NOT NULL DEFAULT 'FUTURES',
  direction TEXT NOT NULL,
  entry NUMERIC NOT NULL DEFAULT 0,
  sl NUMERIC NOT NULL DEFAULT 0,
  tp_1_price NUMERIC NOT NULL DEFAULT 0,
  risk_amount_usd NUMERIC NOT NULL DEFAULT 0,
  position_size_usd NUMERIC NOT NULL DEFAULT 0,
  rr NUMERIC NOT NULL DEFAULT 0,

  adx NUMERIC,
  atr NUMERIC,
  rsi NUMERIC,
  cmf NUMERIC,
  bbw_rank NUMERIC,
  oi_delta NUMERIC,
  funding_rate NUMERIC,
  funding_slope NUMERIC,
  taker_ratio NUMERIC,
  btc_dom_slope NUMERIC,
  mvrv NUMERIC,
  fgi INTEGER,
  vpin NUMERIC,
  obi NUMERIC,
  amihud NUMERIC,
  isi NUMERIC,
  cvd_trend NUMERIC,
  vwap NUMERIC,
  vwap_upper NUMERIC,
  vwap_lower NUMERIC,
  hurst_value NUMERIC,
  liq_longs_vol NUMERIC,
  liq_shorts_vol NUMERIC,
  true_ev NUMERIC,
  kelly_pct NUMERIC,
  trailing_activated BOOLEAN DEFAULT FALSE,

  gate_s1 BOOLEAN DEFAULT FALSE,
  gate_s2 BOOLEAN DEFAULT FALSE,
  gate_s3 BOOLEAN DEFAULT FALSE,
  gate_s4 BOOLEAN DEFAULT FALSE,
  gate_s5 BOOLEAN DEFAULT FALSE,
  gate_s6 BOOLEAN DEFAULT FALSE,
  gate_s7 BOOLEAN DEFAULT FALSE,
  gate_s8 BOOLEAN DEFAULT FALSE,

  trend_sma200 TEXT DEFAULT 'UP',
  leverage INTEGER DEFAULT 1,
  status TEXT DEFAULT 'PENDING',
  pnl_usd NUMERIC DEFAULT 0,
  session TEXT DEFAULT 'ASIAN',
  l1_structure TEXT DEFAULT '',
  l2_volatility TEXT DEFAULT '',
  l3_liq_event TEXT DEFAULT '',
  l4_positioning TEXT DEFAULT '',
  l5_momentum TEXT DEFAULT '',
  l6_macro TEXT DEFAULT '',
  soft_score NUMERIC DEFAULT 0,
  holding_cycles INTEGER DEFAULT 1,
  strategy_name TEXT DEFAULT '',
  capital_at_entry_usd NUMERIC DEFAULT 0,
  strategy_version TEXT DEFAULT 'scalp-v1.0',
  applied_risk_pct NUMERIC DEFAULT 0,
  asset_tier TEXT DEFAULT 'Tier 1: Macro',
  epoch_id TEXT DEFAULT 'scalp-001',
  slippage_usd NUMERIC DEFAULT 0,
  max_favorable_excursion_usd NUMERIC DEFAULT 0,
  max_adverse_excursion_usd NUMERIC DEFAULT 0,
  initial_sl NUMERIC DEFAULT 0,
  initial_risk_per_coin NUMERIC DEFAULT 0,
  opened_at TIMESTAMPTZ,
  filled_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  actual_entry NUMERIC,
  realized_pnl_gross_usd NUMERIC,
  commission_usd NUMERIC,
  funding_fee_usd NUMERIC,
  pnl_attribution TEXT,
  ownership_token TEXT,
  entry_order_id BIGINT,
  entry_client_order_id TEXT,
  sl_algo_id BIGINT,
  tp_algo_id BIGINT,
  sl_client_algo_id TEXT,
  tp_client_algo_id TEXT,
  atr_rank NUMERIC,
  gate_diagnostics JSONB,
  protection_stage TEXT DEFAULT 'NONE',
  high_water_price NUMERIC DEFAULT 0,
  high_water_r NUMERIC DEFAULT 0,
  pee_analyzed BOOLEAN DEFAULT FALSE,
  pee_mfe_usd NUMERIC DEFAULT 0,
  pee_mae_usd NUMERIC DEFAULT 0,
  pee_mfe_candles INTEGER DEFAULT 0,
  exit_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_scalp_symbol ON scalp_trade_logs(symbol);
CREATE INDEX IF NOT EXISTS idx_scalp_status ON scalp_trade_logs(status);
CREATE INDEX IF NOT EXISTS idx_scalp_strategy ON scalp_trade_logs(strategy_name);
CREATE INDEX IF NOT EXISTS idx_scalp_created ON scalp_trade_logs(created_at DESC);

ALTER TABLE scalp_trade_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for service_role"
  ON scalp_trade_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Bảng tham số học máy cho Scalp Bot
CREATE TABLE IF NOT EXISTS scalp_strategy_params (
  id SERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  sl_percent NUMERIC DEFAULT 0.015,
  tp_percent NUMERIC DEFAULT 0.025,
  tp_mult NUMERIC DEFAULT 1.5,
  entry_buffer NUMERIC DEFAULT 0.0005,
  min_score INTEGER DEFAULT 55,
  volume_threshold NUMERIC DEFAULT 1.1,
  sample_count INTEGER DEFAULT 0,
  win_rate NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(strategy_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_scalp_params_strategy ON scalp_strategy_params(strategy_id, symbol);

ALTER TABLE scalp_strategy_params ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for service_role"
  ON scalp_strategy_params
  FOR ALL
  USING (true)
  WITH CHECK (true);

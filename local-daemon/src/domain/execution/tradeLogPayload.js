// 2026-08-13: trade_logs insert payload của main auto-bot (autoBot.js
// executeTrade). Tách ra module thuần để test được payload mà không cần
// import autoBot.js (autoBot chạy startBot() ngay lúc import + mở WS).
// Chỉ chuyển vị trí + null-safe indicator — KHÔNG đổi gate/score/size.
import {
  encodeLiquidityLedgerEvent,
  withLiquidityFeatureVersion
} from '../../../../src/domain/analytics/quant/liquidityMetadata.js';
import { numberOrNull } from '../../../../src/domain/analytics/quant/indicatorPersistence.js';

export const buildTradeLogPayload = ({
  tradeId,
  setup,
  finalEntry,
  finalSl,
  finalTp,
  positionSizeUSD,
  riskAmountUSD,
  riskPercentOfCapital,
  liveCapital,
  slAlgoId,
  tpAlgoId
}) => ({
  id: tradeId,
  symbol: setup.symbol,
  interval: setup.interval,
  type: setup.tradeType || 'FUTURES',
  direction: setup.direction,

  entry: parseFloat(finalEntry),
  initial_entry: parseFloat(finalEntry),
  sl: parseFloat(finalSl),
  tp_1_price: parseFloat(finalTp),

  // ==========================================
  // RISK GEOMETRY / TRAILING V2
  // ==========================================
  initial_sl: parseFloat(finalSl),
  // Chưa biết actual Binance fill
  initial_risk_per_coin: null,
  opened_at: null,
  protection_stage: 'NONE',
  high_water_price: null,
  high_water_r: 0,
  // Legacy compatibility
  trailing_activated: false,

  risk_amount_usd: Math.max(0.1, parseFloat(riskAmountUSD)),
  position_size_usd: parseFloat(positionSizeUSD),
  rr: parseFloat(setup.theoreticalRR),

  // --- CÁC CỘT THỐNG KÊ LÕI ---
  adx: parseFloat(setup.adx || 0),
  atr: parseFloat(setup.atr || 0),
  rsi: parseFloat(setup.rsi || 0),
  cmf: parseFloat(setup.cmf || 0),
  bbw_rank: parseInt(setup.bbwRank || 0),
  oi_delta: parseFloat(setup.oiDelta || 0),
  funding_rate: parseFloat(setup.fundingRate || 0),
  funding_slope: parseFloat(setup.fundingSlope || 0),
  taker_ratio: parseFloat(setup.takerRatio || 1),
  btc_dom_slope: parseFloat(setup.btcDomSlope || 0),
  regime_at_entry: setup.l2 || null,
  btc_regime_at_entry: setup.btcRegime || null,
  mvrv: parseFloat(setup.mvrv || 0),
  fgi: parseInt(setup.fgi || 50),

  // --- CÁC CỘT VI CẤU TRÚC VÀ RỦI RO ---
  vpin: parseFloat(setup.vpin || 0),
  obi: parseFloat(setup.obi || 0.5),
  // 2026-08-13: indicator missing → null (KHÔNG 0 — 0 confound gate
  // đọc lại: vwap=0 chặn 100% LONG + pass 100% SHORT; hurst=0 chặn
  // nhầm trend-family; cvd=0 fail-open méo).
  amihud: numberOrNull(setup.amihud),
  isi: numberOrNull(setup.isi),
  cvd_trend: numberOrNull(setup.cvdTrend),
  vwap: numberOrNull(setup.vwap),
  vwap_upper: numberOrNull(setup.vwapUpper),
  vwap_lower: numberOrNull(setup.vwapLower),
  hurst_value: numberOrNull(setup.hurstValue),
  liq_longs_vol: numberOrNull(setup.liqLongsVol),
  liq_shorts_vol: numberOrNull(setup.liqShortsVol),
  // ------------------------------------------
  true_ev: parseFloat(setup.trueEV || 0),
  kelly_pct: parseFloat(setup.kellyPct || 0),
  // --- BÓC TÁCH SOFT GATES ---
  gate_s1: setup.gateS1 || false,
  gate_s2: setup.gateS2 || false,
  gate_s3: setup.gateS3 || false,
  gate_s4: setup.gateS4 || false,
  gate_s5: setup.gateS5 || false,
  gate_s6: setup.gateS6 || false,
  gate_s7: setup.gateS7 || false,
  gate_s8: setup.gateS8 || false,

  trend_sma200: setup.trendSma200 || 'UP',
  leverage: Math.max(1, Math.ceil(positionSizeUSD / (liveCapital * 0.9 || 1))),
  status: 'PENDING',
  pnl_usd: 0,
  session: setup.session || 'ASIAN',
  l1_structure: setup.l1 || '',
  l2_volatility: setup.l2 || '',
  l3_liq_event: encodeLiquidityLedgerEvent(setup.l3, setup),
  l4_positioning: setup.l4 || '',
  l5_momentum: setup.l5 || '',
  l6_macro: setup.l6 || '',

  soft_score: parseFloat(setup.score || 0),
  holding_cycles: setup.tHold || 1,
  planned_holding_cycles: setup.tHold || 1,
  actual_holding_cycles: null,
  strategy_id: setup.strategyId || 'ADAPTIVE_LONG_FALLBACK',
  strategy_name: `${setup.strategyId || 'ADAPTIVE_LONG_FALLBACK'} [BOT]`,
  capital_at_entry_usd: parseFloat(liveCapital.toFixed(2)),
  strategy_version: withLiquidityFeatureVersion('v1.5.2-auto'),
  applied_risk_pct: parseFloat(riskPercentOfCapital || 0),

  asset_tier: setup.assetTier || 'Tier 2',
  epoch_id: setup.epochId || 'epoch-alpha-001',
  slippage_usd: 0,
  max_favorable_excursion_usd: 0,
  max_adverse_excursion_usd: 0,
  metric_version: 'pending-live-ledger/v2',
  pee_analyzed: false,
  // algoId để xóa đúng CO khi lệnh kết thúc, không ảnh hưởng lệnh khác cùng coin
  sl_algo_id: slAlgoId,
  tp_algo_id: tpAlgoId
});

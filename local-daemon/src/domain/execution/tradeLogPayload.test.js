import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTradeLogPayload } from './tradeLogPayload.js';

const baseSetup = {
  symbol: 'BTCUSDT',
  interval: '15m',
  tradeType: 'FUTURES',
  direction: 'LONG',
  entry: '100.5',
  slTech: '99.5',
  tp1: '105.0',
  theoreticalRR: 2.5,
  adx: 22,
  atr: 0.5,
  score: 70,
  tHold: 4,
  strategyId: 'ADAPTIVE_LONG_FALLBACK',
  l1: 'Trend Up',
  l2: 'Normal',
  l3: 'Quiet',
  l4: 'positioning',
  l5: 'momentum',
  l6: 'macro',
  session: 'ASIAN',
  assetTier: 'Tier 2',
  epochId: 'epoch-alpha-001',
  gateS1: true
};

const baseArgs = {
  tradeId: 'trade-1',
  setup: baseSetup,
  finalEntry: '100.5',
  finalSl: '99.5',
  finalTp: '105.0',
  positionSizeUSD: 55,
  riskAmountUSD: 0.55,
  riskPercentOfCapital: 1,
  liveCapital: 700,
  slAlgoId: 'sl-1',
  tpAlgoId: 'tp-1'
};

// 2026-08-13 regression: autoBot.js payload dùng parseFloat(setup.vwap || 0)
// — indicator MISSING bị bơm thành 0 → Supabase lưu 0 → TradeValidator đọc
// lại: vwapUpper=0 chặn 100% LONG + pass 100% SHORT (confound hướng suốt
// sample); hurst=0 chặn nhầm trend-family; cvd=0 fail-open méo. Missing → null.
test('buildTradeLogPayload: indicator missing → null (KHÔNG 0)', () => {
  const payload = buildTradeLogPayload(baseArgs);
  const nullIndicators = [
    'amihud', 'isi', 'cvd_trend',
    'vwap', 'vwap_upper', 'vwap_lower',
    'hurst_value', 'liq_longs_vol', 'liq_shorts_vol'
  ];
  for (const key of nullIndicators) {
    assert.equal(payload[key], null, `${key} phải là null khi indicator missing`);
  }
});

test('buildTradeLogPayload: indicator có giá trị → parseFloat (0 giữ nguyên 0)', () => {
  const setup = {
    ...baseSetup,
    vwap: '100.2',
    vwapUpper: '101.1',
    vwapLower: '99.3',
    cvdTrend: '-2.5',
    hurstValue: '0.55',
    liqLongsVol: '1200',
    liqShortsVol: '0',
    amihud: '0.9',
    isi: '1.4'
  };
  const payload = buildTradeLogPayload({ ...baseArgs, setup });
  assert.equal(payload.vwap, 100.2);
  assert.equal(payload.vwap_upper, 101.1);
  assert.equal(payload.vwap_lower, 99.3);
  assert.equal(payload.cvd_trend, -2.5);
  assert.equal(payload.hurst_value, 0.55);
  assert.equal(payload.liq_longs_vol, 1200);
  assert.equal(payload.liq_shorts_vol, 0);
  assert.equal(payload.amihud, 0.9);
  assert.equal(payload.isi, 1.4);
});

test('buildTradeLogPayload: giữ nguyên các field không trong scope (regression)', () => {
  const payload = buildTradeLogPayload(baseArgs);
  assert.equal(payload.id, 'trade-1');
  assert.equal(payload.symbol, 'BTCUSDT');
  assert.equal(payload.direction, 'LONG');
  assert.equal(payload.entry, 100.5);
  assert.equal(payload.sl, 99.5);
  assert.equal(payload.tp_1_price, 105);
  assert.equal(payload.rr, 2.5);
  assert.equal(payload.strategy_id, 'ADAPTIVE_LONG_FALLBACK');
  assert.equal(payload.strategy_name, 'ADAPTIVE_LONG_FALLBACK [BOT]');
  assert.equal(payload.status, 'PENDING');
  assert.equal(payload.risk_amount_usd, 0.55);
  assert.equal(payload.position_size_usd, 55);
  assert.equal(payload.leverage, Math.max(1, Math.ceil(55 / (700 * 0.9))));
  assert.equal(payload.sl_algo_id, 'sl-1');
  assert.equal(payload.tp_algo_id, 'tp-1');
  assert.equal(payload.gate_s1, true);
  assert.equal(payload.gate_s2, false);
});

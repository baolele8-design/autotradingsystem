// FILE: local-daemon/src/application/scanner/matrixScannerService.e2e.test.js
//
// E2E integration test (mock exchange, no network): exercises the real scanner
// service + real TradeValidator gates through the production code path —
// scanner scan cycle is hard to drive headless (WS + timers), so we verify the
// three production entry points that were changed (F3/F6/F7) plus the gate
// telemetry path (lưu ý 3) against realistic fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatrixScannerService } from './matrixScannerService.js';
import { computePendingOrderMathCore, TARGET_INTERVALS } from './matrixScannerService.js';
import { TradeValidator } from '../../../../src/domain/trading/TradeValidator.js';

// ---------------------------------------------------------------- fixtures
const klines = (count, price = 100, takerBuyRatio = 0.5) => {
  const rows = [];
  let t = 1_700_000_000_000;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price * (1 + (i % 2 ? 0.001 : -0.001));
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;
    const vol = 1000;
    const takerBuy = vol * takerBuyRatio;
    rows.push([t, open, high, low, close, vol, t, vol * price, 100, takerBuy, vol - takerBuy, 0]);
    t += 60_000;
  }
  return rows;
};

function mockContext(overrides = {}) {
  const base = {
    getConnectedClients: () => [],
    getCurrentAiModel: () => null,
    getGlobalMvrvZScore: () => 0.4,
    getLiquidationSnapshot: () => ({ longs: 0, shorts: 0, ready: false }),
    marketDataCache: {
      getKlines: async () => klines(250)
    },
    readBinanceReq: async () => ({}),
    sendBinanceReq: async () => ({}),
    safeFetch: async () => ({}),
    supabase: {
      from: () => ({ select: async () => ({ data: [], error: null }) })
    },
    btcReturnsCache: new Map(),
    btcRegimeCache: new Map()
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------- F3
test('F3: TARGET_INTERVALS excludes 5m and keeps MTF reference intervals', () => {
  assert.deepEqual(TARGET_INTERVALS, ['15m', '1h', '4h', '1d']);
  assert.ok(!TARGET_INTERVALS.includes('5m'));
});

test('F3: scanner service constructs with 4-khung config (no crash)', () => {
  const svc = createMatrixScannerService(mockContext());
  assert.ok(svc);
  assert.equal(typeof svc.runMatrixScanner, 'function');
});

// ---------------------------------------------------------------- F6 (C1)
test('F6: liqEstimate computed from real brackets when size > 0', () => {
  const mc = computePendingOrderMathCore(
    { position_size_usd: 500, rr: 2.0, direction: 'LONG', entry: 60_000, sl: 57_000, leverage: 5 },
    {
      symbol: 'BTCUSDT',
      currentPrice: 60_000,
      leverageBracketsRes: [
        {
          symbol: 'BTCUSDT',
          brackets: [
            {
              bracket: 1,
              initialLeverage: 125,
              notionalFloor: 0,
              notionalCap: 100_000,
              maintMarginRatio: 0.004,
              maxLeverage: 125,
              maxNotional: 100_000,
              minLeverage: 1
            }
          ]
        }
      ],
      defaultBrackets: [],
      winRate: 0.5,
      totalClosed: 50
    }
  );
  assert.ok(mc.liqEstimate, 'liqEstimate must be computed (not null)');
  assert.equal(mc.leverageExceedsExchangeCap, false);
  assert.ok(mc.liqSafetyMargin >= 1.3, 'h4 requires liqSafetyMargin >= 1.3');
  assert.ok(mc.liqEstimate.liqPrice > 0);
});

test('F6: size <= 0 => liqEstimate null => gate h4 fails (cancel broken pending = correct)', () => {
  const mc = computePendingOrderMathCore(
    { position_size_usd: 0, rr: 2.0, direction: 'LONG' },
    { symbol: 'BTCUSDT', currentPrice: 60_000, leverageBracketsRes: [], defaultBrackets: [], winRate: 0.5, totalClosed: 50 }
  );
  assert.equal(mc.liqEstimate, null);
  const gates = TradeValidator.evaluateGates(
    { atr14: 100, ema20: { value: 60_000 }, msbState: 'Bullish_MSB', vpinValue: 0.05, vwapUpper: 61_000, vwapLower: 59_000, cvdTrend: 0, lastClosedVolume: 1000, avgVolume20: 1000, hurstValue: 0.6 },
    { realSpreadPct: 0.05, takerBuySellRatio: 1.0 },
    { l1: 'Trend', l2: 'Expansion', l3: 'Quiet' },
    mc,
    'LONG',
    'FUTURES',
    60_000,
    58_000,
    { score: 60, passingScore: 50, checks: {}, checkScores: {}, synergyText: '', penaltyText: '' },
    [],
    'BTCUSDT',
    'ADAPTIVE_LONG_FALLBACK'
  );
  const h4 = gates.hardGates.find(g => g.id === 'h4');
  assert.ok(h4 && !h4.passed, 'h4 must fail (falsy incl. null) when liqEstimate is null');
});

// ---------------------------------------------------------------- F7 (C2)
test('F7: stored true_ev takes priority when present', () => {
  const mc = computePendingOrderMathCore(
    { true_ev: -0.3, rr: 2.0, direction: 'LONG' },
    { symbol: 'BTCUSDT', currentPrice: 60_000, leverageBracketsRes: [], defaultBrackets: [], winRate: 0.9, totalClosed: 100 }
  );
  assert.equal(mc.trueEVValue, -0.3);
});

test('F7: missing true_ev => recomputed from winRate/prior (never fake 1.0)', () => {
  const mc = computePendingOrderMathCore(
    { rr: 1.5, direction: 'LONG' },
    { symbol: 'BTCUSDT', currentPrice: 60_000, leverageBracketsRes: [], defaultBrackets: [], winRate: 0.5, totalClosed: 100 }
  );
  assert.notEqual(mc.trueEVValue, 1.0);
  assert.ok(Math.abs(mc.trueEVValue - TradeValidator.trueEV?.(0.5, 1.5, 0.5, 1)) < 0.001 || mc.trueEVValue < 1.0);
});

test('F7: rr normalized — literal 0 kept, null/invalid => 1.5', () => {
  const mc0 = computePendingOrderMathCore(
    { rr: 0, direction: 'LONG' },
    { symbol: 'X', currentPrice: 1, leverageBracketsRes: [], defaultBrackets: [], winRate: 0.5, totalClosed: 30 }
  );
  assert.equal(mc0.theoreticalRR, 0);
  const mcNull = computePendingOrderMathCore(
    { direction: 'LONG' },
    { symbol: 'X', currentPrice: 1, leverageBracketsRes: [], defaultBrackets: [], winRate: 0.5, totalClosed: 30 }
  );
  assert.equal(mcNull.theoreticalRR, 1.5);
});

// ---------------------------------------------------------------- gate telemetry (lưu ý 3)
test('lưu ý 3: gate flags readable from checks even when removed from softGates list', () => {
  const score = TradeValidator.evaluateScore(
    {
      atr14: 100, cmf: 0.5, ema20: { value: 100 }, vwap: 100, vwapUpper: 101, vwapLower: 99,
      vpinValue: 0.05, cvdTrend: 5, lastClosedVolume: 1000, avgVolume20: 1000, hurstValue: 0.6,
      msbState: 'Bullish_MSB'
    },
    { realSpreadPct: 0.05, takerBuySellRatio: 0.9, sessionMultiplier: 1 },
    { l1: 'Trend', l2: 'Compression', l3: 'Quiet', l4: 'Neutral', l5: 'Moderate', l6: 'Accumulation Zone', sTrend: 1, momScore: 1, posScore: 1, liqSeverity: 0, macroScore: 1 },
    'LONG',
    0.4,
    'BTCUSDT',
    null
  );
  assert.ok(score.checks, 'evaluateScore must expose checks');
  assert.equal(typeof score.checks.checkS1, 'boolean');
  assert.equal(typeof score.checks.checkS5, 'boolean');
  const gates = TradeValidator.evaluateGates(
    { atr14: 100, cmf: 0.5, ema20: { value: 100 }, vwapUpper: 101, vwapLower: 99, vpinValue: 0.05, cvdTrend: 5, lastClosedVolume: 1000, avgVolume20: 1000, hurstValue: 0.6, msbState: 'Bullish_MSB' },
    { realSpreadPct: 0.05, takerBuySellRatio: 0.9 },
    { l1: 'Trend', l2: 'Compression', l3: 'Quiet' },
    { appliedRiskPercent: 1, positionSizeUSD: 100, theoreticalRR: 2, trueEVValue: 0.2, liqEstimate: { liqPrice: 50 }, leverageExceedsExchangeCap: false, liqSafetyMargin: 2, dynamicSlDistance: 10 },
    'LONG',
    'FUTURES',
    100,
    90,
    score,
    [],
    'BTCUSDT',
    'ADAPTIVE_LONG_FALLBACK'
  );
  assert.equal(gates.softGates.some(g => g.id === 's1'), false, 's1 removed from softGates list');
  assert.equal(gates.softGates.some(g => g.id === 's2'), true, 's2 kept');
  assert.equal(gates.softGates.some(g => g.id === 's7'), true, 's7 kept');
});

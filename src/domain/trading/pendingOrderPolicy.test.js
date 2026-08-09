import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIMEFRAME_MS_MAP,
  parseTimeframeToMs,
  calculateCandleExpiryMs,
  isPendingOrderExpired,
  evaluatePendingOrderGateInvalidation
} from './pendingOrderPolicy.js';
import { STRATEGY_CATALOG } from './strategyRouter.js';

function createValidOrderFixture(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entry: 100,
    entryPrice: 100,
    slTech: 95,
    sl: 95,
    strategyId: 'CAPITULATION_RECLAIM',
    initialScore: 70,
    passingScore: 50,
    initialAtr: 2,
    tradeType: 'FUTURES',
    timeframe: '15m',
    createdAt: Date.now(),
    ...overrides
  };
}

function createValidSnapshotFixture(overrides = {}) {
  return {
    autoData: {
      atr14: 2,
      cmf: 0.1,
      cvdTrend: 0,
      ema20: { value: 100 },
      hurstValue: 0.55,
      msbState: 'Bullish_MSB',
      vpinValue: 0.05,
      vwapLower: 90,
      vwapUpper: 110,
      ...overrides.autoData
    },
    apiMacro: {
      realSpreadPct: 0.01,
      takerBuySellRatio: 1,
      ...overrides.apiMacro
    },
    vectorDetails: {
      l1: 'Trend Up',
      l2: 'Normal',
      l3: 'Quiet',
      l5: 'Weak / Mixed',
      ...overrides.vectorDetails
    },
    score: 70,
    passingScore: 50,
    ...overrides
  };
}

// ============================================================================
// R1: TIMEFRAME PARSING & CANDLE EXPIRY POLICY TESTS
// ============================================================================

test('TIMEFRAME_MS_MAP - exports correct millisecond mappings for all supported timeframes', () => {
  assert.equal(TIMEFRAME_MS_MAP['1m'], 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['3m'], 3 * 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['5m'], 5 * 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['15m'], 15 * 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['30m'], 30 * 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['1h'], 60 * 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['2h'], 2 * 60 * 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['4h'], 4 * 60 * 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['6h'], 6 * 60 * 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['8h'], 8 * 60 * 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['12h'], 12 * 60 * 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['1d'], 24 * 60 * 60 * 1000);
  assert.equal(TIMEFRAME_MS_MAP['1w'], 7 * 24 * 60 * 60 * 1000);
});

test('parseTimeframeToMs - parses standard and case-insensitive timeframe strings correctly', () => {
  assert.equal(parseTimeframeToMs('15m'), 15 * 60 * 1000);
  assert.equal(parseTimeframeToMs(' 1H '), 60 * 60 * 1000);
  assert.equal(parseTimeframeToMs('4h'), 4 * 60 * 60 * 1000);
  assert.equal(parseTimeframeToMs('1D'), 24 * 60 * 60 * 1000);
  assert.equal(parseTimeframeToMs(300000), 300000);
  assert.ok(Number.isNaN(parseTimeframeToMs('invalid')));
  assert.ok(Number.isNaN(parseTimeframeToMs(null)));
});

test('R1 Requirement: 15m order expires after exactly 3 candles (45m)', () => {
  const createdAt = 1700000000000;
  const timeframe = '15m';
  const duration3Candles = 3 * 15 * 60 * 1000; // 45 minutes = 2,700,000 ms

  const expiryMs = calculateCandleExpiryMs(timeframe, createdAt, 3);
  assert.equal(expiryMs, createdAt + duration3Candles);

  const order = { timeframe, createdAt };

  // Before 45m (e.g. 44m 59s) -> NOT expired
  assert.equal(isPendingOrderExpired(order, createdAt + duration3Candles - 1), false);
  // Exactly at 45m -> EXPIRED
  assert.equal(isPendingOrderExpired(order, createdAt + duration3Candles), true);
  // After 45m -> EXPIRED
  assert.equal(isPendingOrderExpired(order, createdAt + duration3Candles + 1000), true);
});

test('R1 Requirement: 1h order expires after exactly 3 candles (3h)', () => {
  const createdAt = 1700000000000;
  const timeframe = '1h';
  const duration3Candles = 3 * 60 * 60 * 1000; // 3 hours = 10,800,000 ms

  const expiryMs = calculateCandleExpiryMs(timeframe, createdAt, 3);
  assert.equal(expiryMs, createdAt + duration3Candles);

  const order = { timeframe, createdAt };

  assert.equal(isPendingOrderExpired(order, createdAt + duration3Candles - 1), false);
  assert.equal(isPendingOrderExpired(order, createdAt + duration3Candles), true);
  assert.equal(isPendingOrderExpired(order, createdAt + duration3Candles + 5000), true);
});

test('R1 Requirement: 4h order expires after exactly 3 candles (12h)', () => {
  const createdAt = 1700000000000;
  const timeframe = '4h';
  const duration3Candles = 3 * 4 * 60 * 60 * 1000; // 12 hours = 43,200,000 ms

  const expiryMs = calculateCandleExpiryMs(timeframe, createdAt, 3);
  assert.equal(expiryMs, createdAt + duration3Candles);

  const order = { timeframe, createdAt };

  assert.equal(isPendingOrderExpired(order, createdAt + duration3Candles - 1), false);
  assert.equal(isPendingOrderExpired(order, createdAt + duration3Candles), true);
});

test('R1 Requirement: 1d order expires after exactly 3 candles (3d)', () => {
  const createdAt = 1700000000000;
  const timeframe = '1d';
  const duration3Candles = 3 * 24 * 60 * 60 * 1000; // 3 days = 259,200,000 ms

  const expiryMs = calculateCandleExpiryMs(timeframe, createdAt, 3);
  assert.equal(expiryMs, createdAt + duration3Candles);

  const order = { timeframe, createdAt };

  assert.equal(isPendingOrderExpired(order, createdAt + duration3Candles - 1), false);
  assert.equal(isPendingOrderExpired(order, createdAt + duration3Candles), true);
});


// ============================================================================
// R2: GATE INVALIDATION EVALUATION TESTS
// ============================================================================

test('R2: Baseline valid order passes all invalidation checks', () => {
  const order = createValidOrderFixture();
  const snapshot = createValidSnapshotFixture();

  const result = evaluatePendingOrderGateInvalidation(order, snapshot, STRATEGY_CATALOG);
  assert.equal(result.isInvalidated, false);
  assert.equal(result.invalidatedGates.length, 0);
  assert.equal(result.reasons.length, 0);
});

test('R2: Early invalidation on MSB flip (h_msb)', () => {
  const longOrder = createValidOrderFixture({ direction: 'LONG' });
  const snapshotBearishMsb = createValidSnapshotFixture({
    autoData: { msbState: 'Bearish_MSB' }
  });

  const longResult = evaluatePendingOrderGateInvalidation(longOrder, snapshotBearishMsb, STRATEGY_CATALOG);
  assert.equal(longResult.isInvalidated, true);
  assert.ok(longResult.invalidatedGates.includes('h_msb'));

  const shortOrder = createValidOrderFixture({ direction: 'SHORT', entry: 100, slTech: 105 });
  const snapshotBullishMsb = createValidSnapshotFixture({
    autoData: { msbState: 'Bullish_MSB' }
  });

  const shortResult = evaluatePendingOrderGateInvalidation(shortOrder, snapshotBullishMsb, STRATEGY_CATALOG);
  assert.equal(shortResult.isInvalidated, true);
  assert.ok(shortResult.invalidatedGates.includes('h_msb'));
});

test('R2: Soft score drop below passingScore / -15pt degradation', () => {
  // Test A: Drop below passing score (passingScore = 50, score = 45)
  const orderA = createValidOrderFixture({ passingScore: 50 });
  const snapshotLowScore = createValidSnapshotFixture({ score: 45 });

  const resA = evaluatePendingOrderGateInvalidation(orderA, snapshotLowScore, STRATEGY_CATALOG);
  assert.equal(resA.isInvalidated, true);
  assert.ok(resA.invalidatedGates.includes('soft_score_passing'));
  assert.equal(resA.details.softScoreStatus.scoreBelowPassing, true);

  // Test B: 15 pt degradation (initialScore = 80, current score = 60, drop = 20 pts)
  const orderB = createValidOrderFixture({ initialScore: 80, passingScore: 50 });
  const snapshotDegradedScore = createValidSnapshotFixture({ score: 60 });

  const resB = evaluatePendingOrderGateInvalidation(orderB, snapshotDegradedScore, STRATEGY_CATALOG);
  assert.equal(resB.isInvalidated, true);
  assert.ok(resB.invalidatedGates.includes('soft_score_degradation'));
  assert.equal(resB.details.softScoreStatus.scoreDegraded15Pt, true);
});

test('R2: Strategy rule breakdown', () => {
  // Test A: Strategy ID not found in catalog
  const orderUnknownStrategy = createValidOrderFixture({ strategyId: 'NON_EXISTENT_STRATEGY' });
  const snapshot = createValidSnapshotFixture();

  const resA = evaluatePendingOrderGateInvalidation(orderUnknownStrategy, snapshot, STRATEGY_CATALOG);
  assert.equal(resA.isInvalidated, true);
  assert.ok(resA.invalidatedGates.includes('strategy_not_found'));
  assert.equal(resA.details.strategyStatus.found, false);

  // Test B: Score below strategy minScore requirement
  // CAPITULATION_RECLAIM has minScore 62 in strategyRouter catalog
  const orderCapitulation = createValidOrderFixture({ strategyId: 'CAPITULATION_RECLAIM' });
  const snapshotScore60 = createValidSnapshotFixture({ score: 60 });

  const resB = evaluatePendingOrderGateInvalidation(orderCapitulation, snapshotScore60, STRATEGY_CATALOG);
  assert.equal(resB.isInvalidated, true);
  assert.ok(resB.invalidatedGates.includes('strategy_min_score'));
  assert.equal(resB.details.strategyStatus.minScoreMet, false);
});

test('R2: ATR expansion +50%', () => {
  // Initial ATR = 2.0. 50% expansion -> current ATR >= 3.0
  const order = createValidOrderFixture({ initialAtr: 2.0 });

  // Test A: ATR expanded to 3.2 (+60%) -> Invalidated
  const snapshotExpanded = createValidSnapshotFixture({ autoData: { atr14: 3.2 } });
  const resExpanded = evaluatePendingOrderGateInvalidation(order, snapshotExpanded, STRATEGY_CATALOG);
  assert.equal(resExpanded.isInvalidated, true);
  assert.ok(resExpanded.invalidatedGates.includes('atr_expansion_50pct'));
  assert.equal(resExpanded.details.atrStatus.expanded50Pct, true);

  // Test B: ATR expanded to 2.4 (+20%) -> Not invalidated by ATR expansion
  const snapshotNormal = createValidSnapshotFixture({ autoData: { atr14: 2.4 } });
  const resNormal = evaluatePendingOrderGateInvalidation(order, snapshotNormal, STRATEGY_CATALOG);
  assert.equal(resNormal.isInvalidated, false);
  assert.equal(resNormal.details.atrStatus.expanded50Pct, false);
});

test('R2: Individual Hard Gates testing (h_vpin, h_range_block, h_vwap, h_cvd, h_expansion_fomo, h_cmf_breakout, h_hurst, h1)', () => {
  const baseOrder = createValidOrderFixture({ strategyId: 'VOL_COMPRESSION_IGNITION' }); // default policy: no range, no high vpin

  // 1. Toxic VPIN (h_vpin)
  const snapVpin = createValidSnapshotFixture({ autoData: { vpinValue: 0.15 } });
  const resVpin = evaluatePendingOrderGateInvalidation(baseOrder, snapVpin, STRATEGY_CATALOG);
  assert.equal(resVpin.isInvalidated, true);
  assert.ok(resVpin.invalidatedGates.includes('h_vpin'));

  // 2. Range Block (h_range_block)
  const baseOrderNoRange = createValidOrderFixture({ strategyId: 'SMART_MONEY_OI_BUILD' });
  const snapRange = createValidSnapshotFixture({ vectorDetails: { l1: 'L1 Range / Chop' } });
  const resRange = evaluatePendingOrderGateInvalidation(baseOrderNoRange, snapRange, STRATEGY_CATALOG);
  assert.equal(resRange.isInvalidated, true);
  assert.ok(resRange.invalidatedGates.includes('h_range_block'));

  // 3. VWAP Overextended (h_vwap)
  const snapVwap = createValidSnapshotFixture({ autoData: { vwapUpper: 95 } }); // entry 100 >= vwapUpper 95
  const resVwap = evaluatePendingOrderGateInvalidation(baseOrder, snapVwap, STRATEGY_CATALOG);
  assert.equal(resVwap.isInvalidated, true);
  assert.ok(resVwap.invalidatedGates.includes('h_vwap'));

  // 4. CVD Divergence (h_cvd)
  const snapCvd = createValidSnapshotFixture({ autoData: { cvdTrend: -10 } });
  const resCvd = evaluatePendingOrderGateInvalidation(baseOrder, snapCvd, STRATEGY_CATALOG);
  assert.equal(resCvd.isInvalidated, true);
  assert.ok(resCvd.invalidatedGates.includes('h_cvd'));

  // 5. FOMO Expansion (h_expansion_fomo)
  // entry = 100, ema20 = 90, atr14 = 2.0 (distance 10 > 1.5 * 2 = 3)
  const snapFomo = createValidSnapshotFixture({
    vectorDetails: { l2: 'Expansion' },
    autoData: { ema20: { value: 90 }, atr14: 2 }
  });
  const resFomo = evaluatePendingOrderGateInvalidation(baseOrder, snapFomo, STRATEGY_CATALOG);
  assert.equal(resFomo.isInvalidated, true);
  assert.ok(resFomo.invalidatedGates.includes('h_expansion_fomo'));

  // 6. CMF Breakout mismatch (h_cmf_breakout)
  const snapBreakout = createValidSnapshotFixture({
    vectorDetails: { l3: 'Breakout Impending' },
    autoData: { cmf: -0.05 } // LONG order requires CMF > 0
  });
  const resBreakout = evaluatePendingOrderGateInvalidation(baseOrder, snapBreakout, STRATEGY_CATALOG);
  assert.equal(resBreakout.isInvalidated, true);
  assert.ok(resBreakout.invalidatedGates.includes('h_cmf_breakout'));

  // 7. Hurst Exponent Mean-Reverting (h_hurst)
  // VOL_COMPRESSION_IGNITION requires trend persistence
  const snapHurst = createValidSnapshotFixture({ autoData: { hurstValue: 0.35 } });
  const resHurst = evaluatePendingOrderGateInvalidation(baseOrder, snapHurst, STRATEGY_CATALOG);
  assert.equal(resHurst.isInvalidated, true);
  assert.ok(resHurst.invalidatedGates.includes('h_hurst'));

  // 8. Noise Distance SL (h1)
  // entry = 100, slTech = 99.9, atr14 = 2.0 (distance 0.1 <= 0.4 * 2 = 0.8)
  const orderTightSl = createValidOrderFixture({ entry: 100, slTech: 99.9 });
  const snapH1 = createValidSnapshotFixture({ autoData: { atr14: 2.0 } });
  const resH1 = evaluatePendingOrderGateInvalidation(orderTightSl, snapH1, STRATEGY_CATALOG);
  assert.equal(resH1.isInvalidated, true);
  assert.ok(resH1.invalidatedGates.includes('h1'));
});

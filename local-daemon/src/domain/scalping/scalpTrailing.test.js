import test from 'node:test';
import assert from 'node:assert';
import {
  SCALP_STRATEGY_FAMILY_MAP,
  getScalpStrategyFamily,
  calculateScalpTrailingDecision,
  calculateScalpTemporalBarrier
} from './scalpTrailing.js';

test('getScalpStrategyFamily - maps scalp strategy IDs to catalog families', () => {
  assert.strictEqual(getScalpStrategyFamily('S1_EMA_MOMENTUM'), 'TREND_CONTINUATION');
  assert.strictEqual(getScalpStrategyFamily('S2_RSI_SNAP'), 'MEAN_REVERSION');
  assert.strictEqual(getScalpStrategyFamily('S3_BB_SQUEEZE'), 'STRUCTURAL_BREAKOUT');
  assert.strictEqual(getScalpStrategyFamily('UNKNOWN_STRATEGY'), 'UNKNOWN_STRATEGY');
});

test('calculateScalpTrailingDecision - computes trailing stage transitions using family profiles', () => {
  // S1_EMA_MOMENTUM -> TREND_CONTINUATION (BE trigger 0.65R, LOCK trigger 1.30R, TRAIL trigger 2.30R)
  const entryPrice = 100;
  const initialRiskPerCoin = 2; // 2% risk
  const currentSl = 98;

  // At 100.5 (0.25R profit) -> Stage remains NONE
  const d0 = calculateScalpTrailingDecision({
    entryPrice,
    currentSl,
    markPrice: 100.5,
    initialRiskPerCoin,
    direction: 'LONG',
    protectionStage: 'NONE',
    strategyId: 'S1_EMA_MOMENTUM',
    assetTier: 'Tier 2'
  });
  assert.strictEqual(d0.nextStage, 'NONE');
  assert.strictEqual(d0.mappedFamily, 'TREND_CONTINUATION');

  // At 101.5 (0.75R profit) -> Stage moves to BE
  const d1 = calculateScalpTrailingDecision({
    entryPrice,
    currentSl,
    markPrice: 101.5,
    initialRiskPerCoin,
    direction: 'LONG',
    protectionStage: 'NONE',
    strategyId: 'S1_EMA_MOMENTUM',
    assetTier: 'Tier 2'
  });
  assert.strictEqual(d1.nextStage, 'BE');
  assert.ok(d1.targetSl > entryPrice);

  // At 103.0 (1.5R profit) -> Stage moves to LOCK
  const d2 = calculateScalpTrailingDecision({
    entryPrice,
    currentSl,
    markPrice: 103.0,
    initialRiskPerCoin,
    direction: 'LONG',
    protectionStage: 'BE',
    strategyId: 'S1_EMA_MOMENTUM',
    assetTier: 'Tier 2'
  });
  assert.strictEqual(d2.nextStage, 'LOCK');

  // At 105.0 (2.5R profit) -> Stage moves to TRAIL
  const d3 = calculateScalpTrailingDecision({
    entryPrice,
    currentSl,
    markPrice: 105.0,
    initialRiskPerCoin,
    direction: 'LONG',
    protectionStage: 'LOCK',
    strategyId: 'S1_EMA_MOMENTUM',
    assetTier: 'Tier 2'
  });
  assert.strictEqual(d3.nextStage, 'TRAIL');
});

test('calculateScalpTemporalBarrier - computes barrier and applies Soft Extension', () => {
  // Base temporal barrier at NONE stage
  const bNone = calculateScalpTemporalBarrier({
    interval: '5m',
    strategyId: 'S1_EMA_MOMENTUM',
    protectionStage: 'NONE',
    currentProfitR: 1.0
  });
  assert.strictEqual(bNone.softExtensionApplied, false);
  assert.strictEqual(bNone.mappedFamily, 'TREND_CONTINUATION');

  // At BE stage with R = 1.6 -> Soft extension NOT applied (requires LOCK or TRAIL)
  const bBe = calculateScalpTemporalBarrier({
    interval: '5m',
    strategyId: 'S1_EMA_MOMENTUM',
    protectionStage: 'BE',
    currentProfitR: 1.6
  });
  assert.strictEqual(bBe.softExtensionApplied, false);
  assert.strictEqual(bBe.maxHoldingCycles, bNone.baseHoldingCycles);

  // At LOCK stage with R = 1.6 -> Soft Extension (+25%) IS applied
  const bLock = calculateScalpTemporalBarrier({
    interval: '5m',
    strategyId: 'S1_EMA_MOMENTUM',
    protectionStage: 'LOCK',
    currentProfitR: 1.6
  });
  assert.strictEqual(bLock.softExtensionApplied, true);
  assert.strictEqual(bLock.maxHoldingCycles, Math.round(bLock.baseHoldingCycles * 1.25));

  // At TRAIL stage with highWaterR = 2.0 -> Soft Extension (+25%) IS applied
  const bTrail = calculateScalpTemporalBarrier({
    interval: '5m',
    strategyId: 'S1_EMA_MOMENTUM',
    protectionStage: 'TRAIL',
    highWaterR: 2.0
  });
  assert.strictEqual(bTrail.softExtensionApplied, true);
  assert.strictEqual(bTrail.maxHoldingCycles, Math.round(bTrail.baseHoldingCycles * 1.25));
});

test('calculateScalpTemporalBarrier - respects BTC trend alignment', () => {
  const bAligned = calculateScalpTemporalBarrier({
    interval: '5m',
    strategyId: 'S1_EMA_MOMENTUM',
    btcTrendAlignment: true
  });
  const bCounter = calculateScalpTemporalBarrier({
    interval: '5m',
    strategyId: 'S1_EMA_MOMENTUM',
    btcTrendAlignment: false
  });

  assert.ok(bAligned.baseHoldingCycles >= bCounter.baseHoldingCycles);
});

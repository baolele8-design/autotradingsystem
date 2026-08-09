import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateTrailingDecision,
  getTrailingPolicy,
  resolveOptimizedTrailingPolicy
} from './trailingPolicy.js';

test('resolves trailing policy using strategy family catalog', () => {
  // VOL_COMPRESSION_IGNITION is STRUCTURAL_BREAKOUT family (base: be 0.55, lock 1.10, lockAmt 0.55, trail 2.20, dist 0.90)
  // Tier 1 offset: be -0.05, lock -0.10, trail -0.15, dist -0.10
  const breakoutPolicy = getTrailingPolicy('VOL_COMPRESSION_IGNITION', 'Tier 1: Ultra-Liquid');
  assert.equal(Math.round(breakoutPolicy.beTrigger * 100) / 100, 0.50);
  assert.equal(Math.round(breakoutPolicy.lockTrigger * 100) / 100, 1.00);
  assert.equal(breakoutPolicy.lockAmount, 0.55);
  assert.equal(Math.round(breakoutPolicy.trailTrigger * 100) / 100, 2.05);
  assert.equal(Math.round(breakoutPolicy.trailDist * 100) / 100, 0.80);

  // VOLATILITY_EXTREME_FADE is MEAN_REVERSION family
  // Tier 1 offset: be -0.05, lock -0.10, trail -0.15, dist -0.10
  const meanReversionPolicy = getTrailingPolicy('VOLATILITY_EXTREME_FADE', 'Tier 1: Ultra-Liquid');
  assert.equal(Math.round(meanReversionPolicy.beTrigger * 100) / 100, 0.35);
  assert.equal(Math.round(meanReversionPolicy.lockTrigger * 100) / 100, 0.70);
  assert.equal(meanReversionPolicy.lockAmount, 0.45);
  assert.equal(Math.round(meanReversionPolicy.trailTrigger * 100) / 100, 1.35);
  assert.equal(Math.round(meanReversionPolicy.trailDist * 100) / 100, 0.45);
});

test('applies tier offsets to family-based trailing policies', () => {
  // Tier 4 gets offset: be +0.15, lock +0.25, trail +0.35, dist +0.30
  // VOL_COMPRESSION_IGNITION base: be 0.55, lock 1.10, trail 2.20, dist 0.90
  const tier4Policy = getTrailingPolicy('VOL_COMPRESSION_IGNITION', 'Tier 4: Nano/High-Risk');
  assert.equal(Math.round(tier4Policy.beTrigger * 100) / 100, 0.70);
  assert.equal(Math.round(tier4Policy.lockTrigger * 100) / 100, 1.35);
  assert.equal(Math.round(tier4Policy.trailTrigger * 100) / 100, 2.55);
  assert.equal(Math.round(tier4Policy.trailDist * 100) / 100, 1.20);
});

test('falls back gracefully to legacy keyword matching when strategy is unknown', () => {
  const legacyPolicy = getTrailingPolicy('UNKNOWN_STRATEGY_FOO', 'Tier 2: Liquid Majors');
  // Fallback to default (0.50, 1.00, 0.50, 2.00, 1.00) with Tier 2 (no offset)
  assert.equal(legacyPolicy.beTrigger, 0.50);
  assert.equal(legacyPolicy.lockTrigger, 1.00);
});

test('temporarily lowers only Adaptive Short Tier 3 LOCK for observation', () => {
  const observedPolicy = getTrailingPolicy(
    'ADAPTIVE_SHORT_FALLBACK [BOT]',
    'Tier 3: Mid-Cap Equities'
  );
  assert.deepEqual(observedPolicy, {
    beTrigger: 0.9,
    lockTrigger: 1.2,
    lockAmount: 0.5,
    trailTrigger: 2.7,
    trailDist: 1.3499999999999999
  });

  const adaptiveLongTier3 = getTrailingPolicy(
    'ADAPTIVE_LONG_FALLBACK [BOT]',
    'Tier 3: Mid-Cap Equities'
  );
  assert.equal(adaptiveLongTier3.lockTrigger, 1.65);
  assert.equal(adaptiveLongTier3.lockAmount, 0.8);

  const adaptiveShortTier2 = getTrailingPolicy(
    'ADAPTIVE_SHORT_FALLBACK [BOT]',
    'Tier 2: Liquid Majors'
  );
  assert.equal(adaptiveShortTier2.lockTrigger, 1.5);
  assert.equal(adaptiveShortTier2.lockAmount, 0.8);
});

test('resolves only an ACTIVE optimizer trailing cell for the matching regime', () => {
  const active = {
    beTrigger: 0.8,
    lockTrigger: 1.1,
    lockAmount: 0.5,
    trailTrigger: 2,
    trailDist: 0.8
  };
  const model = {
    matrix: {
      'ADAPTIVE_LONG_FALLBACK|Tier 2': {
        dynamic_trailing: {
          by_regime: {
            TRENDING: {
              status: 'ACTIVE',
              sample_size: 15,
              optimized: active
            },
            MEAN_REVERTING: {
              status: 'OBSERVE',
              sample_size: 5,
              optimized: active
            }
          }
        }
      }
    }
  };

  assert.deepEqual(
    resolveOptimizedTrailingPolicy(
      model,
      'ADAPTIVE_LONG_FALLBACK [BOT]',
      'Tier 2',
      'Expansion'
    ),
    active
  );
  assert.equal(
    resolveOptimizedTrailingPolicy(
      model,
      'ADAPTIVE_LONG_FALLBACK [BOT]',
      'Tier 2',
      'Range'
    ),
    null
  );
  assert.equal(
    resolveOptimizedTrailingPolicy(
      model,
      'ADAPTIVE_LONG_FALLBACK [BOT]',
      'Tier 2',
      null
    ),
    null
  );

  assert.equal(
    resolveOptimizedTrailingPolicy(
      {
        matrix: {
          'ADAPTIVE_SHORT_FALLBACK|Tier 3': {
            dynamic_trailing: {
              by_regime: {
                TRENDING: {
                  status: 'ACTIVE',
                  sample_size: 15,
                  optimized: active
                }
              }
            }
          }
        }
      },
      'ADAPTIVE_SHORT_FALLBACK [BOT]',
      'Tier 3',
      'Expansion'
    ),
    null
  );
});

test('uses a validated optimizer override without changing the baseline resolver', () => {
  const decision = calculateTrailingDecision({
    entryPrice: 100,
    currentSl: 95,
    markPrice: 106,
    initialRiskPerCoin: 5,
    direction: 'LONG',
    storedHighWater: 106,
    strategyName: 'ADAPTIVE_LONG_FALLBACK',
    assetTier: 'Tier 2',
    policyOverride: {
      beTrigger: 0.8,
      lockTrigger: 1.1,
      lockAmount: 0.5,
      trailTrigger: 2,
      trailDist: 0.8
    }
  });

  assert.equal(decision.nextStage, 'LOCK');
  assert.equal(decision.targetSl, 102.5);
  assert.equal(
    getTrailingPolicy('ADAPTIVE_LONG_FALLBACK', 'Tier 2').lockTrigger,
    1.5
  );
});

test('prefers an ACTIVE BTC-context proposal and falls back to coin regime', () => {
  const parent = {
    beTrigger: 0.8,
    lockTrigger: 1.2,
    lockAmount: 0.5,
    trailTrigger: 2,
    trailDist: 0.8
  };
  const btcSpecific = {
    beTrigger: 0.7,
    lockTrigger: 1,
    lockAmount: 0.4,
    trailTrigger: 1.8,
    trailDist: 0.7
  };
  const model = {
    matrix: {
      'ADAPTIVE_LONG_FALLBACK|Tier 2': {
        dynamic_trailing: {
          by_regime: {
            MEAN_REVERTING: {
              status: 'ACTIVE',
              sample_size: 20,
              optimized: parent,
              by_btc_regime: {
                BULLISH_TREND: {
                  status: 'ACTIVE',
                  sample_size: 15,
                  optimized: btcSpecific
                },
                RANGE: {
                  status: 'OBSERVE',
                  sample_size: 5,
                  optimized: btcSpecific
                }
              }
            }
          }
        }
      }
    }
  };

  assert.deepEqual(
    resolveOptimizedTrailingPolicy(
      model,
      'ADAPTIVE_LONG_FALLBACK',
      'Tier 2',
      'Range',
      'BULLISH_TREND'
    ),
    btcSpecific
  );
  assert.deepEqual(
    resolveOptimizedTrailingPolicy(
      model,
      'ADAPTIVE_LONG_FALLBACK',
      'Tier 2',
      'Range',
      'RANGE'
    ),
    parent
  );
});

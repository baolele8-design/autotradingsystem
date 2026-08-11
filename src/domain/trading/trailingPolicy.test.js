import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateTrailingDecision,
  getTrailingPolicy,
  resolveOptimizedTrailingPolicy
} from './trailingPolicy.js';

const UNIFIED = {
  beTrigger: 0.2,
  lockTrigger: 0.4,
  lockAmount: 0.2,
  trailTrigger: 0.6,
  trailDist: 0.2
};

test('uses the unified schedule for every strategy family and tier (directive 2026-08-07)', () => {
  const breakoutPolicy = getTrailingPolicy('VOL_COMPRESSION_IGNITION', 'Tier 1: Ultra-Liquid');
  assert.deepEqual(breakoutPolicy, UNIFIED);

  const meanReversionPolicy = getTrailingPolicy('VOLATILITY_EXTREME_FADE', 'Tier 1: Ultra-Liquid');
  assert.deepEqual(meanReversionPolicy, UNIFIED);

  const tier4Policy = getTrailingPolicy('VOL_COMPRESSION_IGNITION', 'Tier 4: Nano/High-Risk');
  assert.deepEqual(tier4Policy, UNIFIED);

  const legacyPolicy = getTrailingPolicy('UNKNOWN_STRATEGY_FOO', 'Tier 2: Liquid Majors');
  assert.deepEqual(legacyPolicy, UNIFIED);
});

test('applies the unified schedule to adaptive strategies including Tier 3', () => {
  const observedPolicy = getTrailingPolicy(
    'ADAPTIVE_SHORT_FALLBACK [BOT]',
    'Tier 3: Mid-Cap Equities'
  );
  assert.deepEqual(observedPolicy, UNIFIED);

  const adaptiveLongTier3 = getTrailingPolicy(
    'ADAPTIVE_LONG_FALLBACK [BOT]',
    'Tier 3: Mid-Cap Equities'
  );
  assert.deepEqual(adaptiveLongTier3, UNIFIED);

  const adaptiveShortTier2 = getTrailingPolicy(
    'ADAPTIVE_SHORT_FALLBACK [BOT]',
    'Tier 2: Liquid Majors'
  );
  assert.deepEqual(adaptiveShortTier2, UNIFIED);
});

test('never resolves an optimizer trailing cell (all cells pinned)', () => {
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

  assert.equal(
    resolveOptimizedTrailingPolicy(
      model,
      'ADAPTIVE_LONG_FALLBACK [BOT]',
      'Tier 2',
      'Expansion'
    ),
    null
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
    0.4
  );
});

test('never resolves a BTC-context optimizer proposal (all cells pinned)', () => {
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

  assert.equal(
    resolveOptimizedTrailingPolicy(
      model,
      'ADAPTIVE_LONG_FALLBACK',
      'Tier 2',
      'Range',
      'BULLISH_TREND'
    ),
    null
  );
  assert.equal(
    resolveOptimizedTrailingPolicy(
      model,
      'ADAPTIVE_LONG_FALLBACK',
      'Tier 2',
      'Range',
      'RANGE'
    ),
    null
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateTemporalBarrier,
  dynamicAsymmetricTargets
} from './risk.js';
import {
  getStrategyDefinition,
  resolveStrategyTierModel,
  routeStrategy
} from '../../trading/strategyRouter.js';
import {
  STRATEGY_TARGET_BASELINE_SEMANTICS
} from '../../trading/strategyOptimizationPolicy.js';

const fallbackInput = {
  autoData: {
    atr14: 2,
    atrPercent: 1,
    currentPrice: 100,
    ema20: { value: 100, slope: 0 },
    ema50: { value: 100, slope: 0 }
  },
  apiMacro: {},
  vectorDetails: {
    l1: 'Trend Up',
    l2: 'Normal',
    sTrend: 0,
    momScore: 0,
    posScore: 0
  },
  direction: 'LONG',
  symbol: 'BTCUSDT',
  assetTier: 'Tier 1: Macro'
};

test('only an eligible strategy-tier cell overrides TP, SL and tHold', () => {
  const routed = routeStrategy(fallbackInput);
  const learnedCell = {
    target_scope: 'strategy-tier',
    target_baseline_semantics: STRATEGY_TARGET_BASELINE_SEMANTICS,
    learning_applied: true,
    sample_size: 15,
    dynamic_targets: {
      optimized: {
        slMult: 2,
        tpMult: 4.5,
        tHold_modifier: 1.4,
        suggested_risk_pct: 9
      }
    }
  };
  const learned = dynamicAsymmetricTargets(
    fallbackInput.autoData,
    fallbackInput.apiMacro,
    fallbackInput.vectorDetails,
    fallbackInput.direction,
    learnedCell,
    fallbackInput.assetTier,
    routed,
    { symbol: fallbackInput.symbol }
  );
  const insufficient = dynamicAsymmetricTargets(
    fallbackInput.autoData,
    fallbackInput.apiMacro,
    fallbackInput.vectorDetails,
    fallbackInput.direction,
    { ...learnedCell, sample_size: 14 },
    fallbackInput.assetTier,
    routed,
    { symbol: fallbackInput.symbol }
  );

  assert.equal(learned.strategyId, 'ADAPTIVE_LONG_FALLBACK');
  assert.equal(learned.slMult, 2);
  assert.equal(learned.tpMult, 4.5);
  assert.equal(learned.tHoldModifier, 1.4);
  assert.equal(learned.modelApplied, true);
  assert.equal(insufficient.modelApplied, false);
  assert.notEqual(insufficient.slMult, learned.slMult);
});

test('tHold-only learning preserves effective VALUE_AREA Tier 2 targets', () => {
  const strategy = getStrategyDefinition('VALUE_AREA_TREND_PULLBACK');
  const autoData = {
    atr14: 2,
    atrPercent: 3,
    currentPrice: 100
  };
  const assetTier = 'Tier 2: Liquid Majors';
  const deterministic = dynamicAsymmetricTargets(
    autoData,
    {},
    {},
    'LONG',
    null,
    assetTier,
    strategy
  );
  const learned = dynamicAsymmetricTargets(
    autoData,
    {},
    {},
    'LONG',
    {
      target_scope: 'strategy-tier',
      target_baseline_semantics:
        STRATEGY_TARGET_BASELINE_SEMANTICS,
      learning_applied: true,
      sample_size: 15,
      dynamic_targets: {
        optimized: {
          slMult: 1.65,
          tpMult: 2.55,
          tHold_modifier: 1.2
        }
      }
    },
    assetTier,
    strategy
  );

  assert.ok(Math.abs(deterministic.slMult - 1.85) < 1e-12);
  assert.ok(Math.abs(deterministic.tpMult - 2.775) < 1e-12);
  assert.ok(
    Math.abs(learned.slMult - deterministic.slMult) < 1e-12
  );
  assert.ok(
    Math.abs(learned.tpMult - deterministic.tpMult) < 1e-12
  );
  assert.equal(learned.tHoldModifier, 1.2);
});

test('strategy-tier resolver supports the stable optimizer index', () => {
  const cell = { target_scope: 'strategy-tier', sample_size: 20 };
  const model = {
    matrix_index: {
      'CAPITULATION_RECLAIM|Tier 1: Macro':
        'capitulation-reclaim|tier-1-macro'
    },
    matrix_by_id: {
      'capitulation-reclaim|tier-1-macro': cell
    }
  };

  assert.equal(
    resolveStrategyTierModel(
      model,
      'CAPITULATION_RECLAIM',
      'Tier 1: Macro'
    ),
    cell
  );
});

test('temporal barrier consumes the strategy profile and tHold modifier', () => {
  const strategy = getStrategyDefinition('VALUE_AREA_TREND_PULLBACK');
  const baseline = calculateTemporalBarrier(
    '1h',
    'FUTURES',
    'LONG',
    { l2: 'Normal' },
    'Tier 3: Mid-Cap Equities',
    10,
    strategy,
    1
  );
  const optimized = calculateTemporalBarrier(
    '1h',
    'FUTURES',
    'LONG',
    { l2: 'Normal' },
    'Tier 3: Mid-Cap Equities',
    10,
    strategy,
    1.5
  );

  assert.equal(baseline, 8);
  assert.equal(optimized, 12);
});

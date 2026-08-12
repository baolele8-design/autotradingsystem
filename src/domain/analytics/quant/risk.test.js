import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateTemporalBarrier,
  dynamicAsymmetricTargets,
  btcTrendAlignmentFor
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
  // B3 FIX (2026-08-12): learned slMult 2.0 bị cap 1.82 (tp cap 2.0 − cost
  // khứ hồi 0.18) — trước: 2.0 qua tự do.
  assert.equal(learned.slMult, 1.82);
  // B3 (TP1 ~1R): tpMult bị clamp về max 2.0 (trước: 4.5 tự do qua)
  assert.equal(learned.tpMult, 2);
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

  // B3 FIX (2026-08-12): sl cap 1.82 (tp cap 2.0 − cost 0.18) — trước:
  // 1.85 qua tự do.
  assert.ok(Math.abs(deterministic.slMult - 1.82) < 1e-12);
  // B3 (TP1 ~1R): deterministic tpMult = round(1.73×1.10, 4) + buffer 0.2 =
  // 2.103 → clamp max 2.0 (trước: floor slMult×1.5 = 2.775)
  assert.ok(Math.abs(deterministic.tpMult - 2.0) < 1e-12);
  assert.ok(
    Math.abs(learned.slMult - deterministic.slMult) < 1e-12
  );
  assert.ok(
    Math.abs(learned.tpMult - deterministic.tpMult) < 1e-12
  );
  assert.equal(learned.tHoldModifier, 1.2);
});

test('B3: high-ATR buffer keeps net RR ≥ 1.0 and slMult ≤ tpMult ≤ slMult×1.35 (VALUE_AREA Tier 2)', () => {
  const strategy = getStrategyDefinition('VALUE_AREA_TREND_PULLBACK');
  const highAtr = dynamicAsymmetricTargets(
    { atr14: 2, atrPercent: 3, currentPrice: 100 },
    {},
    {},
    'LONG',
    null,
    'Tier 2: Liquid Majors',
    strategy
  );
  // ATR 3% > 2% → buffer +0.2 cộng CẢ slMult lẫn tpMult; floor giữ tpMult ≥ slMult
  assert.ok(highAtr.tpMult / highAtr.slMult >= 1.0, `RR=${highAtr.tpMult / highAtr.slMult}`);
  assert.ok(highAtr.slMult <= highAtr.tpMult);
  assert.ok(highAtr.tpMult <= highAtr.slMult * 1.35);

  const lowAtr = dynamicAsymmetricTargets(
    { atr14: 2, atrPercent: 1, currentPrice: 100 },
    {},
    {},
    'LONG',
    null,
    'Tier 2: Liquid Majors',
    strategy
  );
  assert.ok(lowAtr.tpMult / lowAtr.slMult >= 1.0, `RR=${lowAtr.tpMult / lowAtr.slMult}`);
  assert.ok(lowAtr.slMult <= lowAtr.tpMult);
  assert.ok(lowAtr.tpMult <= lowAtr.slMult * 1.35);
});

// B3 FIX regression (2026-08-12): cap tpMult 2.0 từng phá floor
// Math.max(tpMult, slMult) → net RR < 1.0 ở high-ATR và learned slMult rộng.
// Fix: SL cap 1.82 (tp cap 2.0 − cost khứ hồi 2×0.09) + floor tpMult ≥
// slMult + 2×0.09. Cost 0.09 ATR = taker market (slippage 0.1% + fee 0.04%
// mỗi chiều) tại ATR 3%.
const NET_RR_COST_ATR = 0.09;

test('B3 FIX: Tier2 + ATR 3% giữ net RR ≥ 1.0 sau cap TP 2.0 (regression)', () => {
  const strategy = getStrategyDefinition('VALUE_AREA_TREND_PULLBACK');
  const res = dynamicAsymmetricTargets(
    { atr14: 2, atrPercent: 3, currentPrice: 100 },
    {},
    {},
    'LONG',
    null,
    'Tier 2: Liquid Majors',
    strategy
  );
  // pre-fix: sl 1.85, tp clamp 2.0 → (2.0−0.09)/(1.85+0.09) = 0.9845 < 1.0
  const netRR =
    (res.tpMult - NET_RR_COST_ATR) / (res.slMult + NET_RR_COST_ATR);
  // 1e-12 tolerance: (2.0−0.09)/(1.82+0.09) = 0.9999999999999999 trong float
  assert.ok(
    netRR >= 1.0 - 1e-12,
    `Tier2 netRR=${netRR} sl=${res.slMult} tp=${res.tpMult}`
  );
});

test('B3 FIX: Tier4 + ATR 3% giữ net RR ≥ 1.0 sau cap TP 2.0 (regression)', () => {
  const strategy = getStrategyDefinition('VALUE_AREA_TREND_PULLBACK');
  const res = dynamicAsymmetricTargets(
    { atr14: 2, atrPercent: 3, currentPrice: 100 },
    {},
    {},
    'LONG',
    null,
    'Tier 4: Nano/High-Risk',
    strategy
  );
  // pre-fix: sl 1.925, tp clamp 2.0 → (2.0−0.09)/(1.925+0.09) = 0.9479 < 1.0
  const netRR =
    (res.tpMult - NET_RR_COST_ATR) / (res.slMult + NET_RR_COST_ATR);
  assert.ok(
    netRR >= 1.0 - 1e-12,
    `Tier4 netRR=${netRR} sl=${res.slMult} tp=${res.tpMult}`
  );
});

test('B3 FIX: learned slMult 3.0 bị cap → tpMult_final ≥ slMult_final (regression)', () => {
  const learnedCell = {
    target_scope: 'strategy-tier',
    target_baseline_semantics: STRATEGY_TARGET_BASELINE_SEMANTICS,
    learning_applied: true,
    sample_size: 15,
    dynamic_targets: {
      optimized: { slMult: 3.0, tpMult: 3.0, tHold_modifier: 1 }
    }
  };
  const res = dynamicAsymmetricTargets(
    { atr14: 2, atrPercent: 3, currentPrice: 100 },
    {},
    {},
    'LONG',
    learnedCell,
    'Tier 2: Liquid Majors',
    getStrategyDefinition('VALUE_AREA_TREND_PULLBACK')
  );
  // pre-fix: sl 3.2, tp clamp 2.0 → (2.0−0.09)/(3.2+0.09) = 0.5805 < 1.0
  assert.ok(res.slMult <= res.tpMult, `sl=${res.slMult} tp=${res.tpMult}`);
  const netRR =
    (res.tpMult - NET_RR_COST_ATR) / (res.slMult + NET_RR_COST_ATR);
  assert.ok(
    netRR >= 1.0 - 1e-12,
    `learned netRR=${netRR} sl=${res.slMult} tp=${res.tpMult}`
  );
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

test('counter-BTC alignment shortens holding cycles (0.85x)', () => {
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
  const counter = calculateTemporalBarrier(
    '1h',
    'FUTURES',
    'LONG',
    { l2: 'Normal' },
    'Tier 3: Mid-Cap Equities',
    10,
    strategy,
    1,
    false
  );

  assert.equal(baseline, 8);
  assert.equal(counter, Math.round(8 * 0.85));
});

test('aligned BTC trend does NOT extend holding cycles (only-downside modifier)', () => {
  const strategy = getStrategyDefinition('VALUE_AREA_TREND_PULLBACK');
  const aligned = calculateTemporalBarrier(
    '1h',
    'FUTURES',
    'LONG',
    { l2: 'Normal' },
    'Tier 3: Mid-Cap Equities',
    10,
    strategy,
    1,
    true
  );
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

  assert.equal(aligned, baseline, 'aligned trade must not be extended');
});

test('null or undefined BTC alignment leaves holding cycles unchanged', () => {
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

  for (const alignment of [null, undefined]) {
    const result = calculateTemporalBarrier(
      '1h',
      'FUTURES',
      'LONG',
      { l2: 'Normal' },
      'Tier 3: Mid-Cap Equities',
      10,
      strategy,
      1,
      alignment
    );
    assert.equal(result, baseline);
  }
});

test('btcTrendAlignmentFor maps direction vs BTC regime', () => {
  assert.equal(btcTrendAlignmentFor('LONG', 'Uptrend'), true);
  assert.equal(btcTrendAlignmentFor('LONG', 'Strong Trend Up'), true);
  assert.equal(btcTrendAlignmentFor('SHORT', 'Downtrend'), true);
  assert.equal(btcTrendAlignmentFor('LONG', 'Downtrend'), false);
  assert.equal(btcTrendAlignmentFor('SHORT', 'Uptrend'), false);
  assert.equal(btcTrendAlignmentFor('SHORT', 'Range'), null);
  assert.equal(btcTrendAlignmentFor('LONG', 'Sideways'), null);
  assert.equal(btcTrendAlignmentFor('LONG', null), null);
  assert.equal(btcTrendAlignmentFor('LONG', ''), null);
  assert.equal(btcTrendAlignmentFor('LONG', 'SomeWeirdLabel'), null);
});

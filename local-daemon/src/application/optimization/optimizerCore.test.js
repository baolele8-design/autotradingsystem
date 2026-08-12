import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DETERMINISTIC_GATE_WEIGHTS,
  DETERMINISTIC_MIN_SCORE,
  MIN_MATRIX_SAMPLES,
  OPTIMIZATION_SOURCE,
  SUPPORTED_PEE_POLICY_VERSION,
  TARGET_SCOPE,
  analyzeStrategyTierCell,
  buildOptimizationModel,
  classifyBtcRegime,
  classifyBtcRegimeBucket,
  classifyRegimeBucket,
  calculateTrainingFingerprint,
  getEffectiveTargetBaseline,
  getStableStrategyId,
  normalizeOptimizationTrade,
  partitionUsableTrades,
  shouldSkipOptimizationEpoch
} from './optimizerCore.js';

test('training fingerprint is order-independent and changes with learned evidence', () => {
  const first = {
    optimizer_source_id: 'trade_logs:1',
    status: 'WIN',
    pnl_usd: 10,
    max_favorable_excursion_usd: 20,
    btc_regime_at_entry: 'RANGE'
  };
  const second = {
    optimizer_source_id: 'trade_logs:2',
    status: 'LOSS',
    pnl_usd: -5,
    max_favorable_excursion_usd: 2,
    btc_regime_at_entry: 'BEARISH_TREND'
  };

  assert.equal(
    calculateTrainingFingerprint([first, second]),
    calculateTrainingFingerprint([second, first])
  );
  assert.notEqual(
    calculateTrainingFingerprint([first, second]),
    calculateTrainingFingerprint([
      first,
      { ...second, max_favorable_excursion_usd: 3 }
    ])
  );
});

test('skips an epoch only when schema, optimizer and training data all match', () => {
  const next = {
    optimizer_version: '2.3.1',
    model_schema_version: 'strategy-tier-targets/v4',
    training_data_fingerprint: 'fnv1a32:12345678'
  };
  assert.equal(shouldSkipOptimizationEpoch({ ...next }, next), true);
  assert.equal(shouldSkipOptimizationEpoch({
    ...next,
    training_data_fingerprint: 'fnv1a32:87654321'
  }, next), false);
  assert.equal(shouldSkipOptimizationEpoch({
    ...next,
    optimizer_version: 'older'
  }, next), false);
  assert.equal(shouldSkipOptimizationEpoch(null, next), false);
});
import {
  getStrategyDefinition
} from '../../../../src/domain/trading/strategyRouter.js';
import {
  STRATEGY_PROMOTION_POLICY,
  STRATEGY_TARGET_BASELINE_SEMANTICS
} from '../../../../src/domain/trading/strategyOptimizationPolicy.js';

const makeTrade = (overrides = {}) => ({
  strategy_name: '🧭 REGIME PERSISTENCE [BOT]',
  asset_tier: 'Tier 2: Liquid Majors',
  status: 'WIN',
  pnl_usd: 1,
  risk_amount_usd: 1,
  exit_reason: 'TAKE_PROFIT_HIT',
  entry: 100,
  position_size_usd: 1000,
  atr: 2,
  max_adverse_excursion_usd: 50,
  max_favorable_excursion_usd: 80,
  soft_score: 70,
  pee_analyzed: true,
  pee_policy_version: SUPPORTED_PEE_POLICY_VERSION,
  pee_mfe_candles: 12,
  strategy_version: 'v2',
  created_at: '2026-07-25T00:00:00.000Z',
  ...overrides
});

test('derives a stable strategy id and prefers an explicit id', () => {
  assert.equal(
    getStableStrategyId('🧭 REGIME PERSISTENCE [BOT]'),
    'regime-persistence'
  );
  assert.equal(
    getStableStrategyId({
      strategy_id: 'regime-persistence-v2',
      strategy_name: 'Renamed label'
    }),
    'regime-persistence-v2'
  );
});

test('rejects UNCLASSIFIED exit reasons as discretionary-or-unresolved (A3-2)', () => {
  const { usable, rejectionCounts } = partitionUsableTrades([
    makeTrade(),
    makeTrade({ exit_reason: 'UNCLASSIFIED_EXCHANGE_CLOSE' })
  ]);

  assert.equal(usable.length, 1);
  assert.equal(
    rejectionCounts['discretionary-or-unresolved-exit'],
    1
  );
});

test('rejects discretionary, unresolved, and inconsistent outcomes', () => {
  const { usable, rejectionCounts } = partitionUsableTrades([
    makeTrade(),
    makeTrade({ exit_reason: 'MANUAL_CLOSE' }),
    makeTrade({ exit_reason: 'TP_OR_MANUAL_PROFIT' }),
    makeTrade({ exit_reason: null }),
    makeTrade({ status: 'LOSS', pnl_usd: 1, exit_reason: 'STOP_LOSS_HIT' }),
    makeTrade({ status: 'CLOSED' })
  ]);

  assert.equal(usable.length, 1);
  assert.equal(rejectionCounts['discretionary-or-unresolved-exit'], 2);
  assert.equal(rejectionCounts['unresolved-exit-reason'], 1);
  assert.equal(rejectionCounts['status-pnl-mismatch'], 1);
  assert.equal(rejectionCounts['unresolved-status'], 1);
});

test('normalizes resolved live rows without inferring missing outcomes', () => {
  const normalized = normalizeOptimizationTrade({
    id: 42,
    strategyId: 'ADAPTIVE_LONG_FALLBACK',
    assetTier: 'Tier 2: Liquid Majors',
    outcome: 'win',
    pnlUsd: '2.5',
    riskAmountUsd: '1',
    exitReason: 'take_profit_hit',
    entryPrice: '100',
    positionSizeUsd: '1000',
    plannedHoldingCycles: 8,
    actualHoldingCycles: 5
  }, {
    source: OPTIMIZATION_SOURCE.LIVE
  });

  assert.equal(normalized.optimizer_source, OPTIMIZATION_SOURCE.LIVE);
  assert.equal(normalized.optimizer_source_id, 'trade_logs:42');
  assert.equal(normalized.status, 'WIN');
  assert.equal(normalized.exit_reason, 'TAKE_PROFIT_HIT');
  assert.equal(normalized.strategy_name, 'ADAPTIVE_LONG_FALLBACK');
  assert.equal(normalized.asset_tier, 'Tier 2: Liquid Majors');
  assert.equal(normalized.planned_holding_cycles, 8);
  assert.equal(normalized.actual_holding_cycles, 5);

  const { usable, rejectionCounts } = partitionUsableTrades([
    normalized,
    normalizeOptimizationTrade({
      ...normalized,
      id: 43,
      status: 'OPEN',
      outcome: undefined
    }, {
      source: OPTIMIZATION_SOURCE.LIVE
    })
  ]);

  assert.equal(usable.length, 1);
  assert.equal(rejectionCounts['unresolved-status'], 1);
});

test('excludes legacy fixed-window PEE until it is rebuilt by the supported policy', () => {
  const legacy = normalizeOptimizationTrade(makeTrade({
    pee_policy_version: null,
    pee_mfe_usd: 100,
    pee_mae_usd: 50,
    pee_mfe_candles: 24,
    pee_mae_candles: 18
  }));

  assert.equal(legacy.pee_analyzed, false);
  assert.equal(legacy.pee_mfe_usd, null);
  assert.equal(legacy.pee_mae_usd, null);
  assert.equal(legacy.pee_mfe_candles, null);
  assert.equal(legacy.pee_mae_candles, null);

  const rebuilt = normalizeOptimizationTrade(makeTrade({
    pee_mfe_usd: 100,
    pee_mae_usd: 50,
    pee_mfe_candles: 6,
    pee_mae_candles: 2
  }));

  assert.equal(rebuilt.pee_analyzed, true);
  assert.equal(rebuilt.pee_mfe_usd, 100);
  assert.equal(rebuilt.pee_mae_usd, 50);
  assert.equal(rebuilt.pee_mfe_candles, 6);
  assert.equal(rebuilt.pee_mae_candles, 2);
});

test('paper rows cannot tune a LIVE strategy', () => {
  const resolvedPaper = Array.from({
    length: STRATEGY_PROMOTION_POLICY.minimumResolvedPaperTrades
  }, (_, index) => normalizeOptimizationTrade(makeTrade({
    id: index + 1,
    strategy_name: 'CAPITULATION_RECLAIM',
    status: index % 2 === 0 ? 'WIN' : 'LOSS',
    pnl_usd: index % 2 === 0 ? 1 : -1,
    exit_reason:
      index % 2 === 0 ? 'TAKE_PROFIT_HIT' : 'STOP_LOSS_HIT',
    pee_analyzed: false,
    pee_mfe_candles: null,
    holding_cycles: index % 2 === 0 ? 12 : 4
  }), {
    source: OPTIMIZATION_SOURCE.PAPER
  }));
  const liveTrade = normalizeOptimizationTrade(makeTrade({
    id: 999,
    strategy_name: 'CAPITULATION_RECLAIM'
  }), {
    source: OPTIMIZATION_SOURCE.LIVE
  });
  const paperAdaptive = normalizeOptimizationTrade(makeTrade({
    id: 1000,
    strategy_name: 'ADAPTIVE_LONG_FALLBACK'
  }), {
    source: OPTIMIZATION_SOURCE.PAPER
  });

  const { model, usableTrades, rejectedTrades } =
    buildOptimizationModel([
      ...resolvedPaper,
      liveTrade,
      paperAdaptive
    ]);
  const cell =
    model.matrix_by_id[
      'capitulation-reclaim|tier-2-liquid-majors'
    ];

  assert.equal(usableTrades.length, 1);
  assert.equal(rejectedTrades.length, 31);
  assert.deepEqual(
    rejectedTrades.map(item => item.reason).sort(),
    Array(31).fill('paper-source-live-strategy').sort()
  );
  assert.equal(
    model.source_counts.usable[OPTIMIZATION_SOURCE.LIVE],
    1
  );
  assert.equal(
    model.source_counts.rejected[OPTIMIZATION_SOURCE.PAPER],
    31
  );
  assert.equal(cell.promotion_guard.automatic_promotion, false);
  assert.equal(cell.promotion_guard.eligible_for_manual_review, false);
  assert.equal(cell.promotion_guard.rollout_mode, 'LIVE');
  assert.equal(cell.dynamic_targets.optimized.tHold_modifier, 1.0);
});

test('does not learn a strategy-tier cell below fifteen usable samples', () => {
  const trades = Array.from(
    { length: MIN_MATRIX_SAMPLES - 1 },
    (_, index) => makeTrade({ pnl_usd: index + 1 })
  );
  const cell = analyzeStrategyTierCell(trades, {
    strategyId: 'regime-persistence',
    strategyName: '🧭 REGIME PERSISTENCE',
    assetTier: 'Tier 2: Liquid Majors',
    minimumSamples: 3
  });

  assert.equal(cell.learning_applied, false);
  assert.equal(cell.minimum_sample_required, MIN_MATRIX_SAMPLES);
  assert.deepEqual(
    cell.dynamic_targets.optimized,
    {
      // B3 (TP1 ~1R): tpMult baseline mới = round(1.73 × 1.10, 4) = 1.903
      // (trước: round(3.0 × 0.85, 4) = 2.55)
      slMult: 1.65,
      tpMult: 1.903,
      tHold_modifier: 1
    }
  );
  assert.equal(cell.thresholds.minScore, DETERMINISTIC_MIN_SCORE);
});

test('uses the routed strategy profile as the shrinkage baseline', () => {
  const trades = Array.from(
    { length: MIN_MATRIX_SAMPLES - 1 },
    (_, index) => makeTrade({
      pnl_usd: index + 1,
      strategy_name: 'CAPITULATION_RECLAIM'
    })
  );
  const cell = analyzeStrategyTierCell(trades, {
    strategyId: 'capitulation-reclaim',
    strategyName: 'CAPITULATION_RECLAIM',
    assetTier: 'Tier 2: Liquid Majors'
  });

  assert.deepEqual(cell.dynamic_targets.optimized, {
    // B3 (TP1 ~1R): CAPITULATION_RECLAIM profile tpMult 1.38 × 1.10 = 1.518
    // (trước: 2.8 × 0.85 = 2.38)
    slMult: 1.32,
    tpMult: 1.518,
    tHold_modifier: 1
  });
  assert.deepEqual(
    getEffectiveTargetBaseline(
      getStrategyDefinition('CAPITULATION_RECLAIM'),
      'Tier 2: Liquid Majors'
    ),
    cell.target_baseline
  );
  assert.equal(
    cell.target_baseline_semantics,
    STRATEGY_TARGET_BASELINE_SEMANTICS
  );
});

test('learns only target and hold fields with shrinkage', () => {
  const trades = Array.from({ length: MIN_MATRIX_SAMPLES }, (_, index) => {
    const isWin = index < 8;
    return makeTrade({
      status: isWin ? 'WIN' : 'LOSS',
      pnl_usd: isWin ? 1 : -1,
      exit_reason: isWin ? 'TAKE_PROFIT_HIT' : 'STOP_LOSS_HIT',
      soft_score: isWin ? 70 : 44,
      max_adverse_excursion_usd: isWin ? 50 : 20,
      max_favorable_excursion_usd: isWin ? 100 : 80
    });
  });
  const cell = analyzeStrategyTierCell(trades, {
    strategyId: 'regime-persistence',
    strategyName: '🧭 REGIME PERSISTENCE',
    assetTier: 'Tier 2: Liquid Majors'
  });

  assert.equal(cell.target_scope, TARGET_SCOPE);
  assert.equal(cell.sample_size, MIN_MATRIX_SAMPLES);
  assert.equal(cell.learning_applied, true);
  assert.deepEqual(cell.gate_weights, DETERMINISTIC_GATE_WEIGHTS);
  assert.deepEqual(
    Object.keys(cell.dynamic_targets.optimized).sort(),
    ['slMult', 'tHold_modifier', 'tpMult']
  );
  assert.ok(
    cell.dynamic_targets.optimized.slMult >
      1.65
  );
  assert.ok(
    cell.dynamic_targets.optimized.slMult < 2.5
  );
  // B3 (TP1 ~1R): estimate clamp [1.0, 2.0] chặn TP học lại ≥ 2.5R;
  // shrinkage từ baseline 1.903 với estimate 2.0 → ~1.935
  assert.ok(
    cell.dynamic_targets.optimized.tpMult >
      1.9
  );
  assert.ok(
    cell.dynamic_targets.optimized.tpMult < 2.0
  );
  assert.ok(cell.dynamic_targets.optimized.tHold_modifier > 1);
  assert.ok(cell.dynamic_targets.optimized.tHold_modifier < 1.15);
  assert.equal(cell.thresholds.minScore, DETERMINISTIC_MIN_SCORE);
  assert.equal(cell.minScore, DETERMINISTIC_MIN_SCORE);
  assert.equal(
    Object.hasOwn(cell.dynamic_targets.optimized, 'suggested_risk_pct'),
    false
  );
  assert.equal(
    Object.hasOwn(cell.dynamic_targets.optimized, 'entry_penalty'),
    false
  );
});

test('builds stable-id and legacy matrix indexes with scope metadata', () => {
  const trades = Array.from({ length: MIN_MATRIX_SAMPLES }, (_, index) =>
    makeTrade({
      status: index % 2 === 0 ? 'WIN' : 'LOSS',
      pnl_usd: index % 2 === 0 ? 1 : -1,
      exit_reason:
        index % 2 === 0 ? 'TAKE_PROFIT_HIT' : 'STOP_LOSS_HIT'
    })
  );
  const { model, usableTrades, rejectedTrades } = buildOptimizationModel(
    trades,
    { generatedAt: '2026-07-25T00:00:00.000Z' }
  );

  const stableKey = 'regime-persistence|tier-2-liquid-majors';
  const legacyKey =
    '🧭 REGIME PERSISTENCE|Tier 2: Liquid Majors';

  assert.equal(model.target_scope, TARGET_SCOPE);
  assert.equal(model.sample_size, MIN_MATRIX_SAMPLES);
  assert.equal(usableTrades.length, MIN_MATRIX_SAMPLES);
  assert.equal(rejectedTrades.length, 0);
  assert.ok(model.matrix_by_id[stableKey]);
  assert.equal(model.matrix_index[legacyKey], stableKey);
  assert.strictEqual(
    model.matrix[legacyKey],
    model.matrix_by_id[stableKey]
  );
  assert.deepEqual(model.policy.learned_parameters, [
    'tpMult',
    'slMult',
    'tHold_modifier',
    'beTrigger',
    'lockTrigger',
    'lockAmount',
    'trailTrigger',
    'trailDist'
  ]);
  assert.ok(model.policy.prohibited_parameters.includes('minScore'));
});

test('classifies regimes into TRENDING vs MEAN_REVERTING buckets', () => {
  assert.equal(classifyRegimeBucket('Expansion'), 'TRENDING');
  assert.equal(classifyRegimeBucket('Extreme'), 'TRENDING');
  assert.equal(classifyRegimeBucket('Range'), 'MEAN_REVERTING');
  assert.equal(classifyRegimeBucket('Compression'), 'MEAN_REVERTING');
  assert.equal(classifyRegimeBucket(null), 'MEAN_REVERTING');
});

test('classifies structural BTC regimes without treating direction as mean reverting', () => {
  assert.equal(classifyBtcRegime('Uptrend'), 'BULLISH_TREND');
  assert.equal(classifyBtcRegime('Downtrend'), 'BEARISH_TREND');
  assert.equal(classifyBtcRegime('Range'), 'RANGE');
  assert.equal(classifyBtcRegime('Sideways'), 'SIDEWAYS');
  assert.equal(classifyBtcRegime('unexpected-label'), 'UNKNOWN');
  assert.equal(classifyBtcRegime(null), 'UNKNOWN');

  assert.equal(classifyBtcRegimeBucket('Uptrend'), 'TRENDING');
  assert.equal(classifyBtcRegimeBucket('Downtrend'), 'TRENDING');
  assert.equal(classifyBtcRegimeBucket('Range'), 'MEAN_REVERTING');
  assert.equal(classifyBtcRegimeBucket('Sideways'), 'MEAN_REVERTING');
  assert.equal(classifyBtcRegimeBucket(null), 'UNKNOWN');
});

test('builds BTC context summary when trades include btc_regime_at_entry', () => {
  const trades = Array.from({ length: MIN_MATRIX_SAMPLES }, (_, index) =>
    makeTrade({
      status: index % 2 === 0 ? 'WIN' : 'LOSS',
      pnl_usd: index % 2 === 0 ? 1 : -1,
      exit_reason: index % 2 === 0 ? 'TAKE_PROFIT_HIT' : 'STOP_LOSS_HIT',
      btc_regime_at_entry:
        index < 5
          ? 'Uptrend'
          : index < 10
            ? 'Downtrend'
            : index < 14
              ? 'Range'
              : 'unrecognized'
    })
  );
  const { model } = buildOptimizationModel(trades, {
    generatedAt: '2026-07-25T00:00:00.000Z'
  });

  assert.ok(model.btc_context_summary);
  assert.equal(model.btc_context_summary.btc_context_sample_size, 15);
  assert.equal(model.btc_context_summary.btc_classified_context_sample_size, 14);
  assert.equal(model.btc_context_summary.btc_unknown_regime_sample_size, 1);
  assert.equal(model.btc_context_summary.btc_missing_context_sample_size, 0);
  assert.equal(model.btc_context_summary.btc_regime_diversity, 3);
  assert.equal(model.btc_context_summary.btc_trending_trade_pct, 0.7143);
  assert.equal(model.btc_context_summary.btc_ranging_trade_pct, 0.2857);
  assert.equal(model.btc_context_summary.btc_bullish_trade_pct, 0.3571);
  assert.equal(model.btc_context_summary.btc_bearish_trade_pct, 0.3571);
  assert.equal(model.btc_context_summary.btc_range_trade_pct, 0.2857);
  assert.equal(model.btc_context_summary.btc_sideways_trade_pct, 0);
  assert.deepEqual(model.btc_context_summary.btc_regime_counts, {
    BULLISH_TREND: 5,
    BEARISH_TREND: 5,
    RANGE: 4,
    SIDEWAYS: 0,
    UNKNOWN: 1
  });
});

test('reports missing BTC context without inventing a market regime', () => {
  const trades = Array.from({ length: MIN_MATRIX_SAMPLES }, (_, index) =>
    makeTrade({
      status: index % 2 === 0 ? 'WIN' : 'LOSS',
      pnl_usd: index % 2 === 0 ? 1 : -1,
      exit_reason: index % 2 === 0 ? 'TAKE_PROFIT_HIT' : 'STOP_LOSS_HIT',
      btc_regime_at_entry: null
    })
  );
  const { model } = buildOptimizationModel(trades);

  assert.equal(model.btc_context_summary.btc_context_sample_size, 0);
  assert.equal(model.btc_context_summary.btc_classified_context_sample_size, 0);
  assert.equal(
    model.btc_context_summary.btc_missing_context_sample_size,
    MIN_MATRIX_SAMPLES
  );
  assert.equal(model.btc_context_summary.btc_trending_trade_pct, null);
  assert.equal(model.btc_context_summary.btc_ranging_trade_pct, null);
});

test('keeps a five-sample trailing proposal at baseline (unified schedule)', () => {
  const trades = Array.from({ length: 5 }, (_, index) => makeTrade({
    id: index + 1,
    strategy_name: 'ADAPTIVE_SHORT_FALLBACK [BOT]',
    asset_tier: 'Tier 3: Mid-Cap Equities',
    regime_at_entry: 'Range',
    pnl_usd: 0.7,
    risk_amount_usd: 1,
    max_favorable_excursion_usd: 1.05,
    max_adverse_excursion_usd: 0.25
  }));
  const cell = analyzeStrategyTierCell(trades, {
    strategyId: 'adaptive-short-fallback',
    strategyName: 'ADAPTIVE_SHORT_FALLBACK',
    assetTier: 'Tier 3: Mid-Cap Equities'
  });

  const proposal = cell.dynamic_trailing.by_regime.MEAN_REVERTING;
  assert.equal(proposal.status, 'BASELINE');
  assert.equal(proposal.sample_size, 5);
  assert.equal(proposal.reachability.lock_miss_rate, 0);
  assert.deepEqual(proposal.optimized, proposal.baseline);
});

test('forces a fifteen-sample regime proposal back to baseline (pinned schedule)', () => {
  const trades = Array.from({ length: MIN_MATRIX_SAMPLES }, (_, index) =>
    makeTrade({
      id: index + 1,
      strategy_name: 'ADAPTIVE_LONG_FALLBACK [BOT]',
      asset_tier: 'Tier 2: Liquid Majors',
      regime_at_entry: 'Range',
      pnl_usd: 0.7,
      risk_amount_usd: 1,
      max_favorable_excursion_usd: 1.05,
      max_adverse_excursion_usd: 0.25
    })
  );
  const cell = analyzeStrategyTierCell(trades, {
    strategyId: 'adaptive-long-fallback',
    strategyName: 'ADAPTIVE_LONG_FALLBACK',
    assetTier: 'Tier 2: Liquid Majors'
  });

  const proposal = cell.dynamic_trailing.by_regime.MEAN_REVERTING;
  assert.equal(proposal.status, 'BASELINE');
  assert.equal(proposal.sample_size, MIN_MATRIX_SAMPLES);
  assert.equal(
    proposal.activation_block,
    'PERMANENT_PINNED_SCHEDULE'
  );
  assert.equal(proposal.optimized.lockTrigger, proposal.baseline.lockTrigger);
  assert.ok(proposal.optimized.lockAmount < proposal.optimized.lockTrigger);
  assert.ok(proposal.optimized.trailTrigger > proposal.optimized.lockTrigger);
});

test('learns BTC trailing context hierarchically with the same sample guards', () => {
  const bullish = Array.from({ length: 35 }, (_, index) =>
    makeTrade({
      id: index + 1,
      strategy_name: 'ADAPTIVE_LONG_FALLBACK [BOT]',
      asset_tier: 'Tier 2: Liquid Majors',
      regime_at_entry: 'Range',
      btc_regime_at_entry: 'BULLISH_TREND',
      pnl_usd: 0.7,
      risk_amount_usd: 1,
      max_favorable_excursion_usd: 1.05,
      max_adverse_excursion_usd: 0.25
    })
  );
  const bearish = Array.from({ length: 35 }, (_, index) =>
    makeTrade({
      id: 35 + index + 1,
      strategy_name: 'ADAPTIVE_LONG_FALLBACK [BOT]',
      asset_tier: 'Tier 2: Liquid Majors',
      regime_at_entry: 'Range',
      btc_regime_at_entry: 'BEARISH_TREND',
      pnl_usd: 2,
      risk_amount_usd: 1,
      max_favorable_excursion_usd: 3,
      max_adverse_excursion_usd: 0.25
    })
  );
  const cell = analyzeStrategyTierCell([...bullish, ...bearish], {
    strategyId: 'adaptive-long-fallback',
    strategyName: 'ADAPTIVE_LONG_FALLBACK',
    assetTier: 'Tier 2: Liquid Majors'
  });

  const parent = cell.dynamic_trailing.by_regime.MEAN_REVERTING;
  const btcProposal = parent.by_btc_regime.BULLISH_TREND;
  assert.equal(btcProposal.status, 'BASELINE');
  assert.equal(btcProposal.sample_size, 35);
  assert.equal(
    btcProposal.activation_block,
    'PERMANENT_PINNED_SCHEDULE'
  );
  assert.deepEqual(btcProposal.baseline, parent.optimized);
  assert.equal(
    btcProposal.optimized.lockTrigger,
    btcProposal.baseline.lockTrigger
  );
});

test('never activates an adaptive trailing cell (pinned schedule)', () => {
  const trades = Array.from({ length: MIN_MATRIX_SAMPLES }, (_, index) =>
    makeTrade({
      id: index + 1,
      strategy_name: 'ADAPTIVE_SHORT_FALLBACK [BOT]',
      asset_tier: 'Tier 3: Mid-Cap Equities',
      regime_at_entry: 'Range',
      pnl_usd: 0.7,
      risk_amount_usd: 1,
      max_favorable_excursion_usd: 1.05,
      max_adverse_excursion_usd: 0.25
    })
  );
  const cell = analyzeStrategyTierCell(trades, {
    strategyId: 'adaptive-short-fallback',
    strategyName: 'ADAPTIVE_SHORT_FALLBACK',
    assetTier: 'Tier 3: Mid-Cap Equities'
  });

  const proposal = cell.dynamic_trailing.by_regime.MEAN_REVERTING;
  assert.equal(proposal.status, 'BASELINE');
  assert.equal(
    proposal.activation_block,
    'PERMANENT_PINNED_SCHEDULE'
  );
  assert.equal(cell.trailing_learning_applied, false);
});

test('does not learn trailing policy from trades missing regime_at_entry', () => {
  const trades = Array.from({ length: MIN_MATRIX_SAMPLES }, (_, index) =>
    makeTrade({
      id: index + 1,
      strategy_name: 'ADAPTIVE_SHORT_FALLBACK [BOT]',
      asset_tier: 'Tier 3: Mid-Cap Equities',
      regime_at_entry: null,
      pnl_usd: 0.7,
      risk_amount_usd: 1,
      max_favorable_excursion_usd: 1.05,
      max_adverse_excursion_usd: 0.25
    })
  );
  const cell = analyzeStrategyTierCell(trades, {
    strategyId: 'adaptive-short-fallback',
    strategyName: 'ADAPTIVE_SHORT_FALLBACK',
    assetTier: 'Tier 3: Mid-Cap Equities'
  });

  assert.deepEqual(cell.dynamic_trailing.by_regime, {});
  assert.equal(cell.trailing_learning_applied, false);
});

test('keeps a trailing proposal at baseline when only five excursions are usable', () => {
  const trades = Array.from({ length: MIN_MATRIX_SAMPLES }, (_, index) =>
    makeTrade({
      id: index + 1,
      strategy_name: 'ADAPTIVE_SHORT_FALLBACK [BOT]',
      asset_tier: 'Tier 3: Mid-Cap Equities',
      regime_at_entry: 'Range',
      pnl_usd: 0.7,
      risk_amount_usd: 1,
      max_favorable_excursion_usd: index < 5 ? 1.05 : null,
      max_adverse_excursion_usd: index < 5 ? 0.25 : null
    })
  );
  const cell = analyzeStrategyTierCell(trades, {
    strategyId: 'adaptive-short-fallback',
    strategyName: 'ADAPTIVE_SHORT_FALLBACK',
    assetTier: 'Tier 3: Mid-Cap Equities'
  });

  const proposal = cell.dynamic_trailing.by_regime.MEAN_REVERTING;
  assert.equal(proposal.status, 'BASELINE');
  assert.equal(proposal.sample_size, 5);
  assert.equal(cell.trailing_learning_applied, false);
});

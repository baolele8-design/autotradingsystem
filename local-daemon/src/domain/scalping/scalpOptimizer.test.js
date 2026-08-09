import test from 'node:test';
import assert from 'node:assert';
import {
  shrinkTowardBaseline,
  classifyRegimeBucket,
  calculatePercentile,
  buildMainTradeGatePriors,
  optimizeScalpParams,
  getStrategyParams,
  STRATEGY_BASELINES,
  BASELINE_PARAMS
} from './scalpOptimizer.js';

test('shrinkTowardBaseline - uses Empirical Bayes shrinkage w = N / (N + 15)', () => {
  const baseline = 0.015;
  const estimate = 0.025;

  // N = 0 -> exact baseline
  assert.strictEqual(shrinkTowardBaseline(estimate, baseline, 0, 15), baseline);

  // N = 15 -> weight = 15 / (15 + 15) = 0.5 -> exactly halfway (0.020)
  assert.strictEqual(shrinkTowardBaseline(estimate, baseline, 15, 15), 0.020);

  // N = 45 -> weight = 45 / (45 + 15) = 0.75 -> 0.015 + 0.75 * 0.010 = 0.0225
  assert.strictEqual(shrinkTowardBaseline(estimate, baseline, 45, 15), 0.0225);
});

test('classifyRegimeBucket - partitions market regimes into TRENDING vs MEAN_REVERTING', () => {
  assert.strictEqual(classifyRegimeBucket('Expansion'), 'TRENDING');
  assert.strictEqual(classifyRegimeBucket('Strong Trend Up'), 'TRENDING');
  assert.strictEqual(classifyRegimeBucket('Extreme'), 'TRENDING');
  assert.strictEqual(classifyRegimeBucket('Range'), 'MEAN_REVERTING');
  assert.strictEqual(classifyRegimeBucket('Chop / Mean Reversion'), 'MEAN_REVERTING');
  assert.strictEqual(classifyRegimeBucket('Compression'), 'MEAN_REVERTING');
});

test('calculatePercentile - correctly computes linear interpolation percentiles', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.strictEqual(calculatePercentile(values, 0), 1);
  assert.strictEqual(calculatePercentile(values, 50), 5.5);
  assert.strictEqual(calculatePercentile(values, 100), 10);
});

test('optimizeScalpParams - returns baseline priors when samples < MIN_SAMPLES', () => {
  const trades = [
    { status: 'WIN', entry: 100, sl: 98, tp_1_price: 103, pnl_usd: 3, risk_amount_usd: 2, position_size_usd: 100 },
    { status: 'LOSS', entry: 100, sl: 98, tp_1_price: 103, pnl_usd: -2, risk_amount_usd: 2, position_size_usd: 100 }
  ];

  const opt = optimizeScalpParams(trades, 'S1_EMA_MOMENTUM', 'BTCUSDT');
  assert.strictEqual(opt.sample_count, 2);
  assert.strictEqual(opt.learning_applied, false);
  assert.strictEqual(opt.sl_percent, STRATEGY_BASELINES.S1_EMA_MOMENTUM.sl_percent);
  assert.strictEqual(opt.tp_percent, STRATEGY_BASELINES.S1_EMA_MOMENTUM.tp_percent);
});

test('optimizeScalpParams - shrinks parameters and applies shakeout / left-on-table adjustments', () => {
  const trades = [];
  // 12 wins, 8 losses (total 20 samples)
  for (let i = 0; i < 12; i++) {
    trades.push({
      status: 'WIN',
      entry: 100,
      sl: 98.5,
      tp_1_price: 102.5,
      pnl_usd: 2.5,
      risk_amount_usd: 1.5,
      position_size_usd: 100,
      mae_percent: 1.2, // 1.2% MAE
      mfe_percent: 3.5, // 3.5% MFE
      pee_mfe_usd: 3.5, // Left on table (3.5 > 2.5)
      regime_at_entry: i < 6 ? 'Expansion' : 'Range'
    });
  }
  for (let i = 0; i < 8; i++) {
    trades.push({
      status: 'LOSS',
      entry: 100,
      sl: 98.5,
      tp_1_price: 102.5,
      pnl_usd: -1.5,
      risk_amount_usd: 1.5,
      position_size_usd: 100,
      mae_percent: 1.6,
      mfe_percent: 2.2, // 2.2% MFE on loss
      pee_mfe_usd: 2.0, // Shakeout (2.0 >= 1.5)
      regime_at_entry: i < 4 ? 'Strong Trend Up' : 'Chop'
    });
  }

  const opt = optimizeScalpParams(trades, 'S1_EMA_MOMENTUM', 'BTCUSDT');
  assert.strictEqual(opt.sample_count, 20);
  assert.strictEqual(opt.learning_applied, true);
  assert.strictEqual(opt.regime_partitioned, true);
  assert.ok(opt.sl_percent >= 0.008 && opt.sl_percent <= 0.040);
  assert.ok(opt.tp_percent >= 0.012 && opt.tp_percent <= 0.060);
  assert.strictEqual(opt.tp_mult, round(opt.tp_percent / opt.sl_percent, 2));
});

test('getStrategyParams - falls back to baseline for missing or low sample params', () => {
  const learnedParams = {
    'S1_EMA_MOMENTUM|BTCUSDT': {
      sl_percent: 0.018,
      tp_percent: 0.030,
      tp_mult: 1.67,
      entry_buffer: 0.0005,
      min_score: 60,
      volume_threshold: 1.1,
      sample_count: 15,
      win_rate: 0.55
    }
  };

  // Sample count >= 10 -> returns learned params
  const pLearned = getStrategyParams('S1_EMA_MOMENTUM', 'BTCUSDT', learnedParams);
  assert.strictEqual(pLearned.sl_percent, 0.018);
  assert.strictEqual(pLearned.min_score, 60);

  // Sample count < 10 or missing symbol -> returns baseline
  const pBaseline = getStrategyParams('S1_EMA_MOMENTUM', 'ETHUSDT', learnedParams);
  assert.strictEqual(pBaseline.sl_percent, STRATEGY_BASELINES.S1_EMA_MOMENTUM.sl_percent);
  assert.strictEqual(pBaseline.sample_count, 0);
});

test('buildMainTradeGatePriors - learns only resolved, regime-matched main rows', () => {
  const rows = Array.from({ length: 24 }, (_, index) => ({
    status: index % 3 === 0 ? 'LOSS' : 'WIN',
    interval: index % 2 === 0 ? '15m' : '1h',
    direction: index % 2 === 0 ? 'LONG' : 'SHORT',
    exit_reason:
      index % 3 === 0 ? 'STOP_LOSS_HIT' : 'TAKE_PROFIT_HIT',
    pnl_usd: index % 3 === 0 ? -1 : 1.5,
    risk_amount_usd: 1,
    l1_structure: 'Strong Trend Up',
    l2_volatility: index % 4 === 0 ? 'Expansion' : 'Normal',
    rsi: index % 2 === 0 ? 68 + index / 10 : 24 - index / 20,
    entry: 100,
    sl: 98.5,
    tp_1_price: 102.5,
    position_size_usd: 100,
    max_adverse_excursion_usd: 1.2,
    max_favorable_excursion_usd: 2.8
  }));
  rows.push({
    status: 'WIN',
    interval: '15m',
    direction: 'LONG',
    l1_structure: 'Strong Trend Up',
    rsi: 99,
    pnl_usd: 10,
    risk_amount_usd: 1,
    exit_reason: 'MANUAL_CLOSE'
  });

  const priors = buildMainTradeGatePriors(rows);
  assert.strictEqual(
    priors.S1_EMA_MOMENTUM.main_prior_sample_count,
    24
  );
  assert.ok(priors.S1_EMA_MOMENTUM.rsi_long_max < 78);
  assert.ok(priors.S1_EMA_MOMENTUM.rsi_short_min > 15);
  assert.strictEqual(priors.S1_EMA_MOMENTUM.sl_percent, undefined);
  assert.strictEqual(priors.S2_RSI_SNAP, undefined);
});

function round(val, digits = 2) {
  const f = 10 ** digits;
  return Math.round(val * f) / f;
}

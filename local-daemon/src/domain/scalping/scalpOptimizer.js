const numeric = (v, fallback = 0) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

const round = (val, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(val * factor) / factor;
};

export const calculatePercentile = (values, percentile) => {
  const sorted = (values || [])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const index = clamp(percentile, 0, 100) / 100 * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

export const SHRINKAGE_PRIOR_STRENGTH = 15;

export const shrinkTowardBaseline = (
  estimate,
  baseline,
  evidenceCount,
  priorStrength = SHRINKAGE_PRIOR_STRENGTH
) => {
  if (!Number.isFinite(estimate) || evidenceCount <= 0) return baseline;
  const weight = evidenceCount / (evidenceCount + priorStrength);
  return baseline + weight * (estimate - baseline);
};

export const REGIME_BUCKETS = Object.freeze({
  TRENDING: ['Expansion', 'Strong Trend', 'Extreme', 'Trend'],
  MEAN_REVERTING: ['Range', 'Chop', 'Compression']
});

export const classifyRegimeBucket = (regimeAtEntry) => {
  const r = String(regimeAtEntry || '').trim();
  if (REGIME_BUCKETS.TRENDING.some(keyword => r.includes(keyword))) {
    return 'TRENDING';
  }
  return 'MEAN_REVERTING';
};

export const BASELINE_PARAMS = Object.freeze({
  sl_percent: 0.015,
  tp_percent: 0.025,
  tp_mult: 1.5,
  entry_buffer: 0.0005,
  min_score: 55,
  volume_threshold: 1.1,
  sample_count: 0,
  win_rate: null
});

export const STRATEGY_BASELINES = Object.freeze({
  S1_EMA_MOMENTUM: { sl_percent: 0.015, tp_percent: 0.0225, tp_mult: 1.5, entry_buffer: 0.0005, min_score: 55, volume_threshold: 1.1 },
  S2_RSI_SNAP: { sl_percent: 0.018, tp_percent: 0.027, tp_mult: 1.5, entry_buffer: 0.0005, min_score: 55, volume_threshold: 1.0 },
  S3_BB_SQUEEZE: { sl_percent: 0.020, tp_percent: 0.030, tp_mult: 1.5, entry_buffer: 0.0005, min_score: 55, volume_threshold: 1.3 }
});

export const MIN_SAMPLES = 10;
export const MAX_HISTORY_TRADES = 200;
export const MAX_AGE_DAYS = 14;

const finiteOrNull = value => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolvedTrade = trade =>
  ['WIN', 'LOSS'].includes(
    String(trade?.status || '').toUpperCase()
  );

const usableMainTrade = trade => {
  if (!resolvedTrade(trade)) return false;
  if (!['5m', '15m', '1h'].includes(String(trade?.interval || ''))) {
    return false;
  }
  const exitReason = String(trade?.exit_reason || '').toUpperCase();
  if (
    !exitReason ||
    /MANUAL|PANIC|UNCLASSIFIED|UNRESOLVED|UNKNOWN|FORCE_SYNC/.test(
      exitReason
    )
  ) {
    return false;
  }
  const pnl = finiteOrNull(trade?.pnl_usd);
  const risk = finiteOrNull(trade?.risk_amount_usd);
  if (pnl === null || pnl === 0 || risk === null || risk <= 0) return false;
  const status = String(trade.status).toUpperCase();
  return status === 'WIN' ? pnl > 0 : pnl < 0;
};

const regimeText = trade =>
  `${trade?.l1_structure || ''} ${trade?.l2_volatility || ''}`;

export function buildMainTradeGatePriors(rows) {
  const resolved = (rows || []).filter(usableMainTrade);
  const cohorts = {
    S1_EMA_MOMENTUM: resolved.filter(trade =>
      /trend|expansion/i.test(regimeText(trade))
    ),
    S2_RSI_SNAP: resolved.filter(trade =>
      /range|chop|extreme/i.test(regimeText(trade))
    ),
    S3_BB_SQUEEZE: resolved.filter(trade =>
      /compression|expansion/i.test(regimeText(trade))
    )
  };
  const priors = {};

  for (const [strategyId, cohort] of Object.entries(cohorts)) {
    if (cohort.length < MIN_SAMPLES) continue;
    priors[strategyId] = {
      main_prior_sample_count: cohort.length
    };
  }

  const momentumWins = cohorts.S1_EMA_MOMENTUM.filter(
    trade => String(trade.status).toUpperCase() === 'WIN'
  );
  const longRsi = momentumWins
    .filter(trade => String(trade.direction).toUpperCase() === 'LONG')
    .map(trade => finiteOrNull(trade.rsi))
    .filter(value => value !== null && value > 0 && value < 100);
  const shortRsi = momentumWins
    .filter(trade => String(trade.direction).toUpperCase() === 'SHORT')
    .map(trade => finiteOrNull(trade.rsi))
    .filter(value => value !== null && value > 0 && value < 100);
  if (priors.S1_EMA_MOMENTUM) {
    if (longRsi.length >= 8) {
      priors.S1_EMA_MOMENTUM.rsi_long_max = round(clamp(
        shrinkTowardBaseline(
          calculatePercentile(longRsi, 90),
          72,
          longRsi.length
        ),
        65,
        78
      ), 2);
    }
    if (shortRsi.length >= 8) {
      priors.S1_EMA_MOMENTUM.rsi_short_min = round(clamp(
        shrinkTowardBaseline(
          calculatePercentile(shortRsi, 10),
          22,
          shortRsi.length
        ),
        15,
        35
      ), 2);
    }
  }

  return priors;
}

const extractMaePercent = (t) => {
  if (t.mae_percent !== undefined && Number.isFinite(Number(t.mae_percent))) {
    return Math.abs(Number(t.mae_percent)) / (Number(t.mae_percent) > 1 ? 100 : 1);
  }
  const maeUsd = Math.abs(numeric(t.max_adverse_excursion_usd || t.mae_usd));
  const posUsd = numeric(t.position_size_usd || t.notional_usd);
  if (maeUsd > 0 && posUsd > 0) {
    return maeUsd / posUsd;
  }
  const entry = numeric(t.entry || t.entry_price);
  const sl = numeric(t.sl || t.stop_loss);
  if (entry > 0 && sl > 0) {
    return Math.abs(entry - sl) / entry;
  }
  return null;
};

const extractMfePercent = (t) => {
  if (t.mfe_percent !== undefined && Number.isFinite(Number(t.mfe_percent))) {
    return Math.abs(Number(t.mfe_percent)) / (Number(t.mfe_percent) > 1 ? 100 : 1);
  }
  const mfeUsd = Math.abs(numeric(t.max_favorable_excursion_usd || t.mfe_usd));
  const posUsd = numeric(t.position_size_usd || t.notional_usd);
  if (mfeUsd > 0 && posUsd > 0) {
    return mfeUsd / posUsd;
  }
  const entry = numeric(t.entry || t.entry_price);
  const tp = numeric(t.tp_1_price || t.take_profit);
  if (entry > 0 && tp > 0) {
    return Math.abs(tp - entry) / entry;
  }
  return null;
};

export const optimizeScalpParams = (trades, strategyId, symbol, baselineOverride = null) => {
  const baseline = baselineOverride || STRATEGY_BASELINES[strategyId] || BASELINE_PARAMS;
  const usable = (trades || []).filter(t => ['WIN', 'LOSS'].includes(String(t.status || '').toUpperCase()));

  if (!usable || usable.length === 0) {
    return {
      strategy_id: strategyId,
      symbol,
      ...baseline,
      sample_count: 0,
      win_rate: null,
      learning_applied: false
    };
  }

  const wins = usable.filter(t => String(t.status || '').toUpperCase() === 'WIN');
  const losses = usable.filter(t => String(t.status || '').toUpperCase() === 'LOSS');
  const N = usable.length;
  const winRate = wins.length / N;

  const computeBucketEstimates = (bucketWins, bucketLosses) => {
    // 1. SL Percent: 95th percentile MAE % + shakeout penalty
    const winMaeList = bucketWins.map(extractMaePercent).filter(v => v !== null && v > 0);
    let slEst = winMaeList.length >= 2
      ? calculatePercentile(winMaeList, 95)
      : (losses.map(extractMaePercent).filter(v => v !== null && v > 0).length >= 2
        ? calculatePercentile(losses.map(extractMaePercent).filter(v => v !== null && v > 0), 95)
        : baseline.sl_percent);

    const shakeouts = bucketLosses.filter(t => {
      const peeMfe = numeric(t.pee_mfe_usd || t.mfe_usd);
      const risk = numeric(t.risk_amount_usd || t.risk_usd);
      return peeMfe > 0 && risk > 0 && peeMfe >= risk * 1.2;
    });

    if (bucketLosses.length > 0 && (shakeouts.length / bucketLosses.length) > 0.25) {
      slEst *= 1.15;
    }

    // 2. TP Percent: 75th percentile MFE % + left-on-table bonus
    const lossMfeList = bucketLosses.map(extractMfePercent).filter(v => v !== null && v > 0);
    let tpEst = lossMfeList.length >= 2
      ? calculatePercentile(lossMfeList, 75)
      : (wins.map(extractMfePercent).filter(v => v !== null && v > 0).length >= 2
        ? calculatePercentile(wins.map(extractMfePercent).filter(v => v !== null && v > 0), 75)
        : baseline.tp_percent);

    const leftOnTable = bucketWins.filter(t => {
      const peeMfe = numeric(t.pee_mfe_usd || t.mfe_usd);
      const pnl = numeric(t.pnl_usd || t.pnl);
      return peeMfe > 0 && pnl > 0 && peeMfe >= pnl * 1.2;
    });

    if (bucketWins.length > 0 && (leftOnTable.length / bucketWins.length) > 0.30) {
      tpEst *= 1.20;
    }

    return { slEst, tpEst };
  };

  // Regime-weighted estimation
  const trendingTrades = usable.filter(t => classifyRegimeBucket(t.regime_at_entry || t.regimeAtEntry) === 'TRENDING');
  const meanRevTrades = usable.filter(t => classifyRegimeBucket(t.regime_at_entry || t.regimeAtEntry) === 'MEAN_REVERTING');

  let rawSlEst, rawTpEst;
  let regimePartitioned = false;

  if (trendingTrades.length >= 3 && meanRevTrades.length >= 3) {
    regimePartitioned = true;
    const trendingEst = computeBucketEstimates(
      trendingTrades.filter(t => String(t.status || '').toUpperCase() === 'WIN'),
      trendingTrades.filter(t => String(t.status || '').toUpperCase() === 'LOSS')
    );
    const meanRevEst = computeBucketEstimates(
      meanRevTrades.filter(t => String(t.status || '').toUpperCase() === 'WIN'),
      meanRevTrades.filter(t => String(t.status || '').toUpperCase() === 'LOSS')
    );

    const wTrending = trendingTrades.length / N;
    const wMeanRev = meanRevTrades.length / N;

    rawSlEst = trendingEst.slEst * wTrending + meanRevEst.slEst * wMeanRev;
    rawTpEst = trendingEst.tpEst * wTrending + meanRevEst.tpEst * wMeanRev;
  } else {
    const aggEst = computeBucketEstimates(wins, losses);
    rawSlEst = aggEst.slEst;
    rawTpEst = aggEst.tpEst;
  }

  // Empirical Bayes Shrinkage towards baseline priors (w = N / (N + 15))
  const shrunkSl = shrinkTowardBaseline(rawSlEst, baseline.sl_percent, N, SHRINKAGE_PRIOR_STRENGTH);
  const shrunkTp = shrinkTowardBaseline(rawTpEst, baseline.tp_percent, N, SHRINKAGE_PRIOR_STRENGTH);

  // Score threshold estimation
  let targetRawScore = baseline.min_score;
  if (winRate < 0.35) targetRawScore = baseline.min_score + 10;
  else if (winRate < 0.45) targetRawScore = baseline.min_score + 5;
  else if (winRate > 0.60) targetRawScore = baseline.min_score - 5;
  else if (winRate > 0.55) targetRawScore = baseline.min_score - 2;

  const shrunkMinScore = shrinkTowardBaseline(targetRawScore, baseline.min_score, N, SHRINKAGE_PRIOR_STRENGTH);

  // Clamping and final bounds
  const finalSl = round(clamp(shrunkSl, 0.008, 0.040), 4);
  const finalTp = round(clamp(shrunkTp, Math.max(finalSl * 1.2, 0.012), 0.060), 4);
  const finalTpMult = round(finalTp / finalSl, 2);
  const finalMinScore = Math.round(clamp(shrunkMinScore, 45, 75));

  return {
    strategy_id: strategyId,
    symbol,
    sl_percent: finalSl,
    tp_percent: finalTp,
    tp_mult: finalTpMult,
    entry_buffer: baseline.entry_buffer,
    min_score: finalMinScore,
    volume_threshold: baseline.volume_threshold,
    sample_count: N,
    win_rate: round(winRate, 4),
    learning_applied: N >= MIN_SAMPLES,
    regime_partitioned: regimePartitioned
  };
};

export async function loadScalpParams(supabase) {
  try {
    const [
      { data, error },
      { data: mainTrades, error: mainError }
    ] = await Promise.all([
      supabase
        .from('scalp_strategy_params')
        .select('*'),
      supabase
        .from('trade_logs')
        .select('*')
        .in('status', ['WIN', 'LOSS'])
        .order('created_at', { ascending: false })
        .limit(500)
    ]);

    if (error) {
      console.error('[SCALP-OPT] Lỗi đọc params:', error.message);
      return {};
    }

    const paramsMap = {};
    for (const row of (data || [])) {
      const key = `${row.strategy_id}|${row.symbol}`;
      paramsMap[key] = {
        sl_percent: numeric(row.sl_percent),
        tp_percent: numeric(row.tp_percent),
        tp_mult: numeric(row.tp_mult),
        entry_buffer: numeric(row.entry_buffer),
        min_score: numeric(row.min_score, 55),
        volume_threshold: numeric(row.volume_threshold),
        sample_count: row.sample_count || 0,
        win_rate: row.win_rate !== null ? numeric(row.win_rate) : null
      };
    }
    if (mainError) {
      console.error(
        '[SCALP-OPT] Lỗi đọc prior trade_logs:',
        mainError.message
      );
    } else {
      paramsMap.__main_prior = buildMainTradeGatePriors(
        mainTrades || []
      );
    }
    return paramsMap;
  } catch (e) {
    console.error('[SCALP-OPT] Lỗi load params:', e.message);
    return {};
  }
}

export function getStrategyParams(strategyId, symbol, learnedParams) {
  const baseline = STRATEGY_BASELINES[strategyId] || BASELINE_PARAMS;
  const key = `${strategyId}|${symbol}`;
  const learned = learnedParams?.[key];
  const mainPrior = learnedParams?.__main_prior?.[strategyId] || {};

  if (!learned || learned.sample_count < MIN_SAMPLES) {
    return {
      ...baseline,
      ...mainPrior,
      sample_count: 0,
      win_rate: null
    };
  }

  return {
    ...baseline,
    ...mainPrior,
    sl_percent: learned.sl_percent || mainPrior.sl_percent || baseline.sl_percent,
    tp_percent: learned.tp_percent || mainPrior.tp_percent || baseline.tp_percent,
    tp_mult: learned.tp_mult || mainPrior.tp_mult || baseline.tp_mult,
    entry_buffer: learned.entry_buffer || mainPrior.entry_buffer || baseline.entry_buffer,
    min_score: Math.round(learned.min_score || mainPrior.min_score || baseline.min_score),
    volume_threshold: learned.volume_threshold || mainPrior.volume_threshold || baseline.volume_threshold,
    sample_count: learned.sample_count,
    win_rate: learned.win_rate
  };
}

export async function runScalpOptimization(supabase) {
  console.log('[SCALP-OPT] Chạy chu kỳ tối ưu (Empirical Bayes v3.0)...');
  const cutoffDate = new Date(Date.now() - MAX_AGE_DAYS * 86400_000).toISOString();

  try {
    const { data: trades, error } = await supabase
      .from('scalp_trade_logs')
      .select('*')
      .in('status', ['WIN', 'LOSS'])
      .gte('created_at', cutoffDate)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_TRADES);

    if (error) {
      console.error('[SCALP-OPT] Lỗi query trades:', error.message);
      return;
    }

    if (!trades || trades.length === 0) {
      console.log('[SCALP-OPT] Chưa có dữ liệu để học.');
      return;
    }

    const groups = {};
    for (const t of trades) {
      const strategyName = String(t.strategy_name || '').split(' [SCALP]')[0].trim();
      const symbol = String(t.symbol || '').trim().toUpperCase();

      if (!strategyName || !symbol) continue;

      const key = `${strategyName}|${symbol}`;
      if (!groups[key]) {
        groups[key] = { strategyId: strategyName, symbol, trades: [] };
      }

      groups[key].trades.push(t);
    }

    const updates = [];
    let updatedCount = 0;

    for (const [key, group] of Object.entries(groups)) {
      if (group.trades.length < MIN_SAMPLES) continue;

      const optimized = optimizeScalpParams(group.trades, group.strategyId, group.symbol);

      updates.push({
        strategy_id: group.strategyId,
        symbol: group.symbol,
        sl_percent: optimized.sl_percent,
        tp_percent: optimized.tp_percent,
        tp_mult: optimized.tp_mult,
        entry_buffer: optimized.entry_buffer,
        min_score: optimized.min_score,
        volume_threshold: optimized.volume_threshold,
        sample_count: optimized.sample_count,
        win_rate: optimized.win_rate,
        updated_at: new Date().toISOString()
      });

      updatedCount++;
    }

    if (updates.length > 0) {
      const { error: upsertError } = await supabase
        .from('scalp_strategy_params')
        .upsert(updates, { onConflict: 'strategy_id,symbol' });

      if (upsertError) {
        console.error('[SCALP-OPT] Lỗi upsert params:', upsertError.message);
      } else {
        console.log(`[SCALP-OPT] Đã cập nhật ${updatedCount} bộ tham số bằng Empirical Bayes Shrinkage.`);
      }
    } else {
      console.log('[SCALP-OPT] Chưa đủ dữ liệu để học cho bất kỳ chiến thuật nào.');
    }
  } catch (e) {
    console.error('[SCALP-OPT] Lỗi optimizer:', e.message);
  }
}

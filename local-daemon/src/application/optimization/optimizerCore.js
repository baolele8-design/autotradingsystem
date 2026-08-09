import { createHash } from 'node:crypto';

import {
  getStrategyDefinition,
  ROLLOUT_MODE
} from '../../../../src/domain/trading/strategyRouter.js';
import {
  getTrailingPolicy,
  isPinnedTrailingPolicyCell
} from '../../../../src/domain/trading/trailingPolicy.js';
import {
  getStrategyTierTargetModifiers,
  STRATEGY_PROMOTION_POLICY,
  STRATEGY_TARGET_BASELINE_SEMANTICS,
  STRATEGY_TARGET_LIMITS,
  STRATEGY_TARGET_SCOPE,
  STRATEGY_TIER_MIN_SAMPLES
} from '../../../../src/domain/trading/strategyOptimizationPolicy.js';

export const OPTIMIZER_VERSION = '2.4.0';
export const MODEL_SCHEMA_VERSION = 'strategy-tier-targets-path/v5';
export const SUPPORTED_PEE_POLICY_VERSION = 'pee-planned-hold-v1';
export const TARGET_SCOPE = STRATEGY_TARGET_SCOPE;
export const MIN_MATRIX_SAMPLES = STRATEGY_TIER_MIN_SAMPLES;
export const SHRINKAGE_PRIOR_STRENGTH = 30;
export const TRAILING_OBSERVATION_MIN_SAMPLES = 5;

export const OPTIMIZATION_SOURCE = Object.freeze({
  LIVE: 'trade_logs',
  PAPER: 'paper_trade_logs'
});

export const DETERMINISTIC_GATE_WEIGHTS = Object.freeze({
  s1: 2.0,
  s2: 2.0,
  s3: 1.5,
  s4: 0.5,
  s5: 1.0,
  s6: 1.5,
  s7: 1.0,
  s8: 1.5,
  msb: 2.5
});

export const DETERMINISTIC_TARGETS = Object.freeze({
  slMult: 1.5,
  tpMult: 3.0,
  tHold_modifier: 1.0
});

export const DETERMINISTIC_MIN_SCORE = 50;

const BLOCKED_EXIT_REASON_PATTERN =
  /MANUAL|PANIC|UNRESOLVED|UNKNOWN|FORCE_SYNC/i;

const PROFIT_EXIT_REASON_PATTERN = /TAKE_PROFIT|TP_|PROFIT/i;
const LOSS_EXIT_REASON_PATTERN = /STOP_LOSS|SL_|LOSS/i;

export const REGIME_BUCKETS = Object.freeze({
  TRENDING: ['Expansion', 'Strong Trend', 'Extreme'],
  MEAN_REVERTING: ['Range', 'Compression']
});

export const classifyRegimeBucket = (regimeAtEntry) => {
  const r = String(regimeAtEntry || '').trim();
  if (REGIME_BUCKETS.TRENDING.some(keyword => r.includes(keyword))) {
    return 'TRENDING';
  }
  return 'MEAN_REVERTING';
};

export const BTC_REGIME = Object.freeze({
  BULLISH_TREND: 'BULLISH_TREND',
  BEARISH_TREND: 'BEARISH_TREND',
  RANGE: 'RANGE',
  SIDEWAYS: 'SIDEWAYS',
  UNKNOWN: 'UNKNOWN'
});

export const classifyBtcRegime = btcRegimeAtEntry => {
  const normalized = String(btcRegimeAtEntry || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/gu, '_');

  if (['UPTREND', 'STRONG_TREND_UP', 'BULLISH_TREND'].includes(normalized)) {
    return BTC_REGIME.BULLISH_TREND;
  }
  if (['DOWNTREND', 'STRONG_TREND_DOWN', 'BEARISH_TREND'].includes(normalized)) {
    return BTC_REGIME.BEARISH_TREND;
  }
  if (normalized === 'RANGE') return BTC_REGIME.RANGE;
  if (normalized === 'SIDEWAYS') return BTC_REGIME.SIDEWAYS;
  return BTC_REGIME.UNKNOWN;
};

export const classifyBtcRegimeBucket = btcRegimeAtEntry => {
  const regime = classifyBtcRegime(btcRegimeAtEntry);
  if (
    regime === BTC_REGIME.BULLISH_TREND ||
    regime === BTC_REGIME.BEARISH_TREND
  ) {
    return 'TRENDING';
  }
  if (regime === BTC_REGIME.RANGE || regime === BTC_REGIME.SIDEWAYS) {
    return 'MEAN_REVERTING';
  }
  return 'UNKNOWN';
};

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const TRAINING_FINGERPRINT_FIELDS = Object.freeze([
  'optimizer_source_id',
  'status',
  'exit_reason',
  'strategy_id',
  'strategy_name',
  'asset_tier',
  'direction',
  'pnl_usd',
  'risk_amount_usd',
  'atr_at_entry',
  'max_favorable_excursion_usd',
  'max_adverse_excursion_usd',
  'pee_analyzed',
  'pee_policy_version',
  'pee_window_candles',
  'pee_mfe_usd',
  'pee_mae_usd',
  'pee_mfe_candles',
  'pee_mae_candles',
  'planned_holding_cycles',
  'actual_holding_cycles',
  'holding_cycles',
  'regime_at_entry',
  'btc_regime_at_entry',
  'metric_version',
  'live_path_summary'
]);

export const calculateTrainingFingerprint = trades => {
  const rows = [...(trades || [])]
    .sort((left, right) =>
      String(left?.optimizer_source_id || '')
        .localeCompare(String(right?.optimizer_source_id || ''))
    )
    .map(trade =>
      TRAINING_FINGERPRINT_FIELDS.map(field => trade?.[field] ?? null)
    );
  const input = JSON.stringify(rows);
  return `sha256:${createHash('sha256').update(input).digest('hex')}`;
};

export const shouldSkipOptimizationEpoch = (previousModel, nextModel) => (
  Boolean(previousModel) &&
  previousModel.optimizer_version === nextModel?.optimizer_version &&
  previousModel.model_schema_version === nextModel?.model_schema_version &&
  previousModel.training_data_fingerprint ===
    nextModel?.training_data_fingerprint
);

const finiteNumber = value => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstDefined = (...values) =>
  values.find(value => value !== undefined && value !== null);

const normalizeOptimizationSource = value => {
  const source = String(value || '').trim().toLowerCase();
  if (source === 'paper' || source === OPTIMIZATION_SOURCE.PAPER) {
    return OPTIMIZATION_SOURCE.PAPER;
  }
  if (
    !source ||
    source === 'live' ||
    source === OPTIMIZATION_SOURCE.LIVE
  ) {
    return OPTIMIZATION_SOURCE.LIVE;
  }
  return source;
};

/**
 * Projects live and paper rows onto the same read-only optimizer contract.
 * Unknown/missing values remain unresolved so the clean-sample guard can
 * reject them; this function deliberately does not infer outcomes.
 */
export const normalizeOptimizationTrade = (
  trade,
  { source = trade?.optimizer_source } = {}
) => {
  if (!trade || typeof trade !== 'object') return trade;

  const optimizerSource = normalizeOptimizationSource(source);
  const strategyId = firstDefined(
    trade.strategy_id,
    trade.strategyId
  );
  const strategyName = firstDefined(
    trade.strategy_name,
    trade.strategyName,
    strategyId
  );
  const status = String(
    firstDefined(trade.status, trade.outcome, '')
  ).trim().toUpperCase();
  const direction = String(
    firstDefined(trade.direction, trade.side, '')
  ).trim().toUpperCase();
  const exitReason = String(
    firstDefined(trade.exit_reason, trade.exitReason, '')
  ).trim().toUpperCase();
  const peePolicyVersion = firstDefined(
    trade.pee_policy_version,
    trade.peePolicyVersion
  );
  const hasSupportedPee =
    (
      trade.pee_analyzed === true ||
      String(trade.pee_analyzed || '').toLowerCase() === 'true'
    ) &&
    peePolicyVersion === SUPPORTED_PEE_POLICY_VERSION;

  return {
    ...trade,
    optimizer_source: optimizerSource,
    optimizer_source_id:
      trade.id === undefined || trade.id === null
        ? null
        : `${optimizerSource}:${trade.id}`,
    strategy_id: strategyId,
    strategy_name: strategyName,
    asset_tier: firstDefined(trade.asset_tier, trade.assetTier),
    status,
    direction,
    exit_reason: exitReason,
    entry: firstDefined(trade.entry, trade.entry_price, trade.entryPrice),
    sl: firstDefined(
      trade.sl,
      trade.initial_sl,
      trade.stop_loss,
      trade.slTech
    ),
    tp_1_price: firstDefined(
      trade.tp_1_price,
      trade.take_profit,
      trade.tp1
    ),
    pnl_usd: firstDefined(
      trade.pnl_usd,
      trade.pnlUsd,
      trade.realized_pnl_usd,
      trade.pnl
    ),
    risk_amount_usd: firstDefined(
      trade.risk_amount_usd,
      trade.riskAmountUsd,
      trade.risk_usd
    ),
    position_size_usd: firstDefined(
      trade.position_size_usd,
      trade.positionSizeUsd,
      trade.notional_usd
    ),
    atr: firstDefined(trade.atr, trade.atr14),
    max_adverse_excursion_usd: firstDefined(
      trade.max_adverse_excursion_usd,
      trade.mae_usd,
      trade.maxAdverseExcursionUsd
    ),
    max_favorable_excursion_usd: firstDefined(
      trade.max_favorable_excursion_usd,
      trade.mfe_usd,
      trade.maxFavorableExcursionUsd
    ),
    holding_cycles: firstDefined(
      trade.holding_cycles,
      trade.holdingCycles
    ),
    planned_holding_cycles: firstDefined(
      trade.planned_holding_cycles,
      trade.plannedHoldingCycles
    ),
    actual_holding_cycles: firstDefined(
      trade.actual_holding_cycles,
      trade.actualHoldingCycles
    ),
    pee_analyzed: hasSupportedPee,
    pee_policy_version: peePolicyVersion,
    pee_window_candles: hasSupportedPee
      ? firstDefined(trade.pee_window_candles, trade.peeWindowCandles)
      : null,
    pee_mfe_usd: hasSupportedPee
      ? firstDefined(trade.pee_mfe_usd, trade.peeMfeUsd)
      : null,
    pee_mae_usd: hasSupportedPee
      ? firstDefined(trade.pee_mae_usd, trade.peeMaeUsd)
      : null,
    pee_mfe_candles: hasSupportedPee
      ? firstDefined(
          trade.pee_mfe_candles,
          trade.peeMfeCandles,
          trade.time_to_peak_candles
        )
      : null,
    pee_mae_candles: hasSupportedPee
      ? firstDefined(trade.pee_mae_candles, trade.peeMaeCandles)
      : null,
    close_time: firstDefined(
      trade.close_time,
      trade.closed_at,
      trade.resolved_at
    ),
    created_at: firstDefined(trade.created_at, trade.opened_at),
    regime_at_entry: firstDefined(
      trade.regime_at_entry,
      trade.regimeAtEntry,
      trade.vector_l2
    ),
    btc_regime_at_entry: firstDefined(
      trade.btc_regime_at_entry,
      trade.btcRegimeAtEntry
    ),
    metric_version: firstDefined(
      trade.metric_version,
      trade.metricVersion,
      optimizerSource === OPTIMIZATION_SOURCE.PAPER
        ? 'paper-replay/legacy'
        : undefined
    ),
    live_path_summary: firstDefined(
      trade.live_path_summary,
      trade.livePathSummary
    )
  };
};

export const calculatePercentile = (values, percentile) => {
  const sorted = (values || [])
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;

  const index = clamp(percentile, 0, 100) / 100 * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

export const cleanStrategyName = value => {
  const cleaned = String(value || '')
    .normalize('NFKC')
    .replace(/\s*\[BOT\]\s*$/iu, '')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!cleaned || /^UNKNOWN$/iu.test(cleaned)) return null;
  return cleaned;
};

const slugify = value => String(value || '')
  .normalize('NFKD')
  .replace(/\p{Mark}/gu, '')
  .replace(/[Đđ]/gu, 'd')
  .toLowerCase()
  .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
  .replace(/^-+|-+$/gu, '');

export const getStableStrategyId = tradeOrName => {
  if (tradeOrName && typeof tradeOrName === 'object') {
    const explicitId = slugify(tradeOrName.strategy_id);
    if (explicitId) return explicitId;
    return slugify(cleanStrategyName(tradeOrName.strategy_name)) || null;
  }

  return slugify(cleanStrategyName(tradeOrName)) || null;
};

export const getStableTierId = tier => slugify(tier) || null;

const toCatalogStrategyId = value => String(value || '')
  .normalize('NFKD')
  .replace(/\p{Mark}/gu, '')
  .replace(/[^a-zA-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '')
  .toUpperCase();

const getTradeStrategyDefinition = trade => {
  const candidates = [
    trade?.strategy_id,
    cleanStrategyName(trade?.strategy_name)
  ];

  for (const candidate of candidates) {
    const exact = getStrategyDefinition(candidate);
    if (exact) return exact;

    const catalogId = toCatalogStrategyId(candidate);
    const normalized = getStrategyDefinition(catalogId);
    if (normalized) return normalized;
  }

  return null;
};

export const getTradeExclusionReason = trade => {
  if (!trade || !['WIN', 'LOSS'].includes(trade.status)) {
    return 'unresolved-status';
  }

  const strategyName = cleanStrategyName(trade.strategy_name);
  const strategyId = getStableStrategyId(trade);
  if (!strategyName || !strategyId) return 'unresolved-strategy';
  if (!String(trade.asset_tier || '').trim()) return 'unresolved-tier';

  const optimizerSource = normalizeOptimizationSource(
    trade.optimizer_source
  );
  if (!Object.values(OPTIMIZATION_SOURCE).includes(optimizerSource)) {
    return 'unsupported-optimizer-source';
  }
  if (optimizerSource === OPTIMIZATION_SOURCE.PAPER) {
    const definition = getTradeStrategyDefinition(trade);
    if (!definition) return 'paper-source-unrecognized-strategy';
    if (definition.rolloutMode !== ROLLOUT_MODE.PAPER_ONLY) {
      return 'paper-source-live-strategy';
    }
  } else {
    const definition = getTradeStrategyDefinition(trade);
    if (definition?.rolloutMode === ROLLOUT_MODE.PAPER_ONLY) {
      return 'live-source-paper-strategy';
    }
  }

  const exitReason = String(trade.exit_reason || '').trim();
  if (!exitReason) return 'unresolved-exit-reason';
  if (BLOCKED_EXIT_REASON_PATTERN.test(exitReason)) {
    return 'discretionary-or-unresolved-exit';
  }

  const pnlUsd = finiteNumber(trade.pnl_usd);
  const riskUsd = finiteNumber(trade.risk_amount_usd);
  if (pnlUsd === null || pnlUsd === 0 || riskUsd === null || riskUsd <= 0) {
    return 'invalid-outcome-numbers';
  }

  if (
    (trade.status === 'WIN' && pnlUsd <= 0) ||
    (trade.status === 'LOSS' && pnlUsd >= 0)
  ) {
    return 'status-pnl-mismatch';
  }

  if (
    (PROFIT_EXIT_REASON_PATTERN.test(exitReason) && pnlUsd <= 0) ||
    (LOSS_EXIT_REASON_PATTERN.test(exitReason) && pnlUsd >= 0)
  ) {
    return 'exit-reason-pnl-mismatch';
  }

  return null;
};

export const partitionUsableTrades = trades => {
  const usable = [];
  const rejected = [];
  const rejectionCounts = {};

  for (const rawTrade of trades || []) {
    const trade = normalizeOptimizationTrade(rawTrade);
    const reason = getTradeExclusionReason(trade);
    if (!reason) {
      usable.push(trade);
      continue;
    }

    rejected.push({ trade, reason });
    rejectionCounts[reason] = (rejectionCounts[reason] || 0) + 1;
  }

  return { usable, rejected, rejectionCounts };
};

const countTradesBySource = trades => {
  const counts = {
    [OPTIMIZATION_SOURCE.LIVE]: 0,
    [OPTIMIZATION_SOURCE.PAPER]: 0
  };

  for (const trade of trades || []) {
    const source = normalizeOptimizationSource(trade?.optimizer_source);
    counts[source] = (counts[source] || 0) + 1;
  }

  return counts;
};

export const createDeterministicModel = ({
  targetScope = 'deterministic-fallback',
  sampleSize = 0,
  strategyId = null,
  strategyName = null,
  assetTier = null,
  generatedAt = null,
  baselineTargets = DETERMINISTIC_TARGETS
} = {}) => ({
  target_scope: targetScope,
  target_baseline_semantics: STRATEGY_TARGET_BASELINE_SEMANTICS,
  strategy_id: strategyId,
  strategy_name: strategyName,
  asset_tier: assetTier,
  sample_size: sampleSize,
  learning_applied: false,
  gate_weights: { ...DETERMINISTIC_GATE_WEIGHTS },
  gate_weights_source: 'deterministic-v1',
  target_baseline: { ...baselineTargets },
  dynamic_targets: {
    optimized: { ...baselineTargets }
  },
  thresholds: {
    minScore: DETERMINISTIC_MIN_SCORE
  },
  // Compatibility alias for consumers that expect a root-level threshold.
  minScore: DETERMINISTIC_MIN_SCORE,
  optimizer_version: OPTIMIZER_VERSION,
  model_schema_version: MODEL_SCHEMA_VERSION,
  generated_at: generatedAt
});

export const getEffectiveTargetBaseline = (
  definition,
  assetTier
) => {
  const profileTargets = definition?.profile
    ? {
        slMult: definition.profile.slMult,
        tpMult: definition.profile.tpMult
      }
    : DETERMINISTIC_TARGETS;
  const modifiers = getStrategyTierTargetModifiers(assetTier);

  return {
    slMult: round(clamp(
      profileTargets.slMult * modifiers.sl,
      STRATEGY_TARGET_LIMITS.slMult.minimum,
      STRATEGY_TARGET_LIMITS.slMult.maximum
    )),
    tpMult: round(clamp(
      profileTargets.tpMult * modifiers.tp,
      STRATEGY_TARGET_LIMITS.tpMult.minimum,
      STRATEGY_TARGET_LIMITS.tpMult.maximum
    )),
    tHold_modifier: DETERMINISTIC_TARGETS.tHold_modifier
  };
};

const shrinkTowardBaseline = (
  estimate,
  baseline,
  evidenceCount,
  priorStrength = SHRINKAGE_PRIOR_STRENGTH
) => {
  if (!Number.isFinite(estimate) || evidenceCount <= 0) return baseline;
  const weight = evidenceCount / (evidenceCount + priorStrength);
  return baseline + weight * (estimate - baseline);
};

const excursionInAtr = (trade, field) => {
  const excursionUsd = Math.abs(finiteNumber(trade[field]) || 0);
  const entry = finiteNumber(trade.entry);
  const positionSizeUsd = finiteNumber(trade.position_size_usd);
  const atr = finiteNumber(trade.atr);

  if (
    excursionUsd <= 0 ||
    entry === null ||
    entry <= 0 ||
    positionSizeUsd === null ||
    positionSizeUsd <= 0 ||
    atr === null ||
    atr <= 0
  ) {
    return null;
  }

  const positionSizeCoins = positionSizeUsd / entry;
  if (!Number.isFinite(positionSizeCoins) || positionSizeCoins <= 0) {
    return null;
  }

  const excursion = excursionUsd / positionSizeCoins / atr;
  return Number.isFinite(excursion) && excursion > 0 ? excursion : null;
};

const calculateSlEstimate = (winningTrades, losingTrades, baseline) => {
  const winMaeAtr = winningTrades
    .map(trade => excursionInAtr(trade, 'max_adverse_excursion_usd'))
    .filter(Number.isFinite);

  if (winMaeAtr.length < 5) {
    return { estimate: baseline, evidenceCount: winMaeAtr.length };
  }

  let estimate = calculatePercentile(winMaeAtr, 95);
  const peeLosses = losingTrades.filter(trade =>
    trade.pee_analyzed === true &&
    finiteNumber(trade.pee_mfe_usd) !== null &&
    finiteNumber(trade.risk_amount_usd) > 0
  );

  if (peeLosses.length >= 5) {
    const shakeoutRate = peeLosses.filter(trade =>
      finiteNumber(trade.pee_mfe_usd) >=
        finiteNumber(trade.risk_amount_usd) * 1.5
    ).length / peeLosses.length;
    if (shakeoutRate > 0.25) estimate *= 1.15;
  }

  // Keep the estimate robust and bounded before Bayesian shrinkage.
  estimate = clamp(estimate, 0.5, 3.5);
  return {
    estimate,
    evidenceCount: winMaeAtr.length + peeLosses.length
  };
};

const calculateTpEstimate = (losingTrades, winningTrades, baseline) => {
  const lossMfeAtr = losingTrades
    .map(trade => excursionInAtr(trade, 'max_favorable_excursion_usd'))
    .filter(Number.isFinite);

  if (lossMfeAtr.length < 5) {
    return { estimate: baseline, evidenceCount: lossMfeAtr.length };
  }

  let estimate = calculatePercentile(lossMfeAtr, 75);

  const peeWins = winningTrades.filter(trade =>
    trade.pee_analyzed === true &&
    finiteNumber(trade.pee_mfe_usd) !== null &&
    finiteNumber(trade.pnl_usd) !== null
  );

  if (peeWins.length >= 5) {
    const leftOnTableRate = peeWins.filter(trade =>
      finiteNumber(trade.pee_mfe_usd) >= finiteNumber(trade.pnl_usd)
    ).length / peeWins.length;

    if (leftOnTableRate > 0.30) estimate *= 1.20;
  }

  return {
    estimate: clamp(estimate, 1.5, 15),
    evidenceCount: lossMfeAtr.length
  };
};

const calculateHoldEstimate = (winningTrades, losingTrades, baseline) => {
  const estimates = [];
  let evidenceCount = 0;

  const timeToPeak = winningTrades
    .map(trade => {
      if (trade.pee_analyzed === true) {
        return finiteNumber(trade.pee_mfe_candles);
      }
      if (
        trade.optimizer_source === OPTIMIZATION_SOURCE.PAPER &&
        PROFIT_EXIT_REASON_PATTERN.test(trade.exit_reason || '')
      ) {
        // A resolved paper TP reaches its target on holding_cycles, so this
        // is a safe time-to-target observation. Do not make the same
        // inference for stopped or unresolved simulations.
        return finiteNumber(trade.holding_cycles);
      }
      return null;
    })
    .filter(value => Number.isFinite(value) && value > 0);

  if (timeToPeak.length >= 3) {
    const medianCandlesToPeak = calculatePercentile(timeToPeak, 50);
    estimates.push(
      medianCandlesToPeak > 8
        ? 1.15
        : medianCandlesToPeak < 4
          ? 0.90
          : baseline
    );
    evidenceCount += timeToPeak.length;
  }

  const timeDecayLosses = losingTrades.filter(trade =>
    trade.exit_reason === 'TEMPORAL_BARRIER_HIT' &&
    finiteNumber(trade.pee_mfe_usd) !== null &&
    finiteNumber(trade.risk_amount_usd) > 0
  );

  if (timeDecayLosses.length >= 3) {
    const prematureRate = timeDecayLosses.filter(trade =>
      finiteNumber(trade.pee_mfe_usd) >= finiteNumber(trade.risk_amount_usd)
    ).length / timeDecayLosses.length;
    estimates.push(prematureRate > 0.30 ? 1.15 : 0.90);
    evidenceCount += timeDecayLosses.length;
  }

  if (estimates.length === 0) {
    return { estimate: baseline, evidenceCount: 0 };
  }

  return {
    estimate: estimates.reduce((sum, value) => sum + value, 0) / estimates.length,
    evidenceCount
  };
};

const excursionInR = (trade, field) => {
  const excursion = finiteNumber(trade[field]);
  const risk = finiteNumber(trade.risk_amount_usd);
  if (excursion === null || risk === null || risk <= 0) return null;
  return Math.abs(excursion) / risk;
};

const roundToStep = (value, step = 0.05) =>
  round(Math.round(value / step) * step, 2);
const floorToStep = (value, step = 0.05) =>
  round(Math.floor((value + Number.EPSILON) / step) * step, 2);

const buildTrailingProposal = (
  trades,
  baseline,
  minimumActiveSamples
) => {
  const mfeR = trades
    .map(trade => excursionInR(trade, 'max_favorable_excursion_usd'))
    .filter(Number.isFinite);
  if (mfeR.length < TRAILING_OBSERVATION_MIN_SAMPLES) return null;

  const winningTrades = trades.filter(trade => trade.status === 'WIN');
  const winnerMaeR = winningTrades
    .map(trade => excursionInR(trade, 'max_adverse_excursion_usd'))
    .filter(Number.isFinite);
  const givebackR = winningTrades
    .map(trade => {
      const favorable = excursionInR(
        trade,
        'max_favorable_excursion_usd'
      );
      const pnl = finiteNumber(trade.pnl_usd);
      const risk = finiteNumber(trade.risk_amount_usd);
      if (
        favorable === null ||
        pnl === null ||
        risk === null ||
        risk <= 0
      ) {
        return null;
      }
      return Math.max(0, favorable - pnl / risk);
    })
    .filter(Number.isFinite);

  const missRate = trigger =>
    round(mfeR.filter(value => value < trigger).length / mfeR.length);
  const optimized = { ...baseline };
  const hasActiveMfeEvidence = mfeR.length >= minimumActiveSamples;

  const minimumMaeEvidence = hasActiveMfeEvidence
    ? minimumActiveSamples
    : TRAILING_OBSERVATION_MIN_SAMPLES;
  if (winnerMaeR.length >= minimumMaeEvidence) {
    const beEstimate = clamp(
      roundToStep(calculatePercentile(winnerMaeR, 75) + 0.10),
      0.35,
      baseline.beTrigger
    );
    optimized.beTrigger = roundToStep(shrinkTowardBaseline(
      beEstimate,
      baseline.beTrigger,
      winnerMaeR.length
    ));
  }

  const lockMissRate = missRate(baseline.lockTrigger);
  if (lockMissRate >= 0.80) {
    const lockEstimate = clamp(
      roundToStep(calculatePercentile(mfeR, 50)),
      optimized.beTrigger + 0.10,
      baseline.lockTrigger
    );
    optimized.lockTrigger = floorToStep(shrinkTowardBaseline(
      lockEstimate,
      baseline.lockTrigger,
      mfeR.length
    ));
    optimized.lockAmount = roundToStep(clamp(
      baseline.lockAmount / baseline.lockTrigger *
        optimized.lockTrigger,
      0.10,
      optimized.lockTrigger - 0.05
    ));
  }

  const trailMissRate = missRate(baseline.trailTrigger);
  if (trailMissRate >= 0.80) {
    const trailEstimate = clamp(
      roundToStep(calculatePercentile(mfeR, 75)),
      optimized.lockTrigger + 0.20,
      baseline.trailTrigger
    );
    optimized.trailTrigger = floorToStep(shrinkTowardBaseline(
      trailEstimate,
      baseline.trailTrigger,
      mfeR.length
    ));
  }

  if (
    hasActiveMfeEvidence &&
    givebackR.length >= minimumActiveSamples
  ) {
    optimized.trailDist = roundToStep(clamp(
      calculatePercentile(givebackR, 50),
      0.30,
      baseline.trailDist
    ));
  }

  const changed = Object.keys(baseline).some(
    key => optimized[key] !== baseline[key]
  );
  const usablePaths = trades
    .map(trade => trade.live_path_summary)
    .filter(path => (
      path?.path_version === 'mark-price-live/v1' &&
      finiteNumber(path.coverage_ratio) >= 0.9 &&
      finiteNumber(path.mfe_r) !== null &&
      finiteNumber(path.mae_r) !== null
    ));
  const actualShadowPaths = usablePaths.filter(
    path => path.shadow_results?.actual
  );
  const rollbackShadowPaths = usablePaths.filter(
    path => path.shadow_results?.rollback
  );
  const stopRate = (paths, name) => paths.length === 0
    ? null
    : round(paths.filter(path =>
        path.shadow_results?.[name]?.stop_hit_at !== null
      ).length / paths.length);
  const median = (paths, field) => calculatePercentile(
    paths.map(path => finiteNumber(path[field])).filter(Number.isFinite),
    50
  );

  return {
    status:
      changed && hasActiveMfeEvidence
        ? 'ACTIVE'
        : changed
          ? 'OBSERVE'
          : 'BASELINE',
    sample_size: mfeR.length,
    baseline: { ...baseline },
    optimized,
    reachability: {
      be_miss_rate: missRate(baseline.beTrigger),
      lock_miss_rate: lockMissRate,
      trail_miss_rate: trailMissRate
    },
    evidence: {
      mfe: mfeR.length,
      winner_mae: winnerMaeR.length,
      winner_giveback: givebackR.length,
      usable_live_path: usablePaths.length
    },
    path_evidence: {
      activation_mode: 'OBSERVATION_ONLY',
      minimum_coverage_ratio: 0.9,
      sample_size: usablePaths.length,
      median_mfe_r: median(usablePaths, 'mfe_r'),
      median_mae_r: median(usablePaths, 'mae_r'),
      median_reversals: median(usablePaths, 'reversal_count'),
      actual_shadow_stop_rate: stopRate(actualShadowPaths, 'actual'),
      rollback_shadow_stop_rate: stopRate(rollbackShadowPaths, 'rollback')
    }
  };
};

const buildRegimeTrailingProposals = (
  trades,
  strategyName,
  assetTier,
  minimumActiveSamples
) => {
  const baseline = getTrailingPolicy(strategyName, assetTier);
  const groups = new Map();
  for (const trade of trades || []) {
    if (!String(trade.regime_at_entry || '').trim()) continue;
    const regime = classifyRegimeBucket(trade.regime_at_entry);
    if (!groups.has(regime)) groups.set(regime, []);
    groups.get(regime).push(trade);
  }

  const byRegime = {};
  for (const [regime, regimeTrades] of groups) {
    const proposal = buildTrailingProposal(
      regimeTrades,
      baseline,
      minimumActiveSamples
    );
    if (proposal) {
      proposal.by_btc_regime = {};
      const btcGroups = new Map();
      for (const trade of regimeTrades) {
        const btcRegime = classifyBtcRegime(
          trade.btc_regime_at_entry
        );
        if (btcRegime === BTC_REGIME.UNKNOWN) continue;
        if (!btcGroups.has(btcRegime)) btcGroups.set(btcRegime, []);
        btcGroups.get(btcRegime).push(trade);
      }
      for (const [btcRegime, btcTrades] of btcGroups) {
        const btcProposal = buildTrailingProposal(
          btcTrades,
          proposal.optimized,
          minimumActiveSamples
        );
        if (!btcProposal) continue;
        if (
          (btcProposal.status === 'ACTIVE' ||
            btcProposal.status === 'OBSERVE') &&
          isPinnedTrailingPolicyCell(strategyName)
        ) {
          btcProposal.status = 'BASELINE';
          btcProposal.activation_block =
            'PERMANENT_PINNED_SCHEDULE';
        }
        proposal.by_btc_regime[btcRegime] = btcProposal;
      }
      if (
        (proposal.status === 'ACTIVE' ||
          proposal.status === 'OBSERVE') &&
        isPinnedTrailingPolicyCell(strategyName)
      ) {
        proposal.status = 'BASELINE';
        proposal.activation_block =
          'PERMANENT_PINNED_SCHEDULE';
      }
      byRegime[regime] = proposal;
    }
  }
  return { by_regime: byRegime };
};

const hasActiveTrailingProposal = dynamicTrailing =>
  Object.values(dynamicTrailing?.by_regime || {}).some(proposal =>
    proposal.status === 'ACTIVE' ||
    Object.values(proposal.by_btc_regime || {}).some(
      btcProposal => btcProposal.status === 'ACTIVE'
    )
  );

const getVersionMetadata = trades => {
  const sourceStrategyVersions = [...new Set(
    trades
      .map(trade => String(trade.strategy_version || '').trim())
      .filter(Boolean)
  )].sort();
  const sourceMetricVersions = [...new Set(
    trades
      .map(trade => String(trade.metric_version || '').trim())
      .filter(Boolean)
  )].sort();
  const timestamps = trades
    .map(trade => Date.parse(trade.close_time || trade.created_at || ''))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  return {
    optimizer_version: OPTIMIZER_VERSION,
    model_schema_version: MODEL_SCHEMA_VERSION,
    source_strategy_versions: sourceStrategyVersions,
    source_metric_versions:
      sourceMetricVersions.length > 0
        ? sourceMetricVersions
        : ['legacy-unversioned'],
    first_observed_at:
      timestamps.length > 0
        ? new Date(timestamps[0]).toISOString()
        : null,
    last_observed_at:
      timestamps.length > 0
        ? new Date(timestamps[timestamps.length - 1]).toISOString()
        : null
  };
};

export const analyzeStrategyTierCell = (
  trades,
  {
    strategyId,
    strategyName,
    assetTier,
    generatedAt = null,
    minimumSamples = MIN_MATRIX_SAMPLES
  }
) => {
  const sampleSize = trades?.length || 0;
  const enforcedMinimumSamples = Math.max(
    MIN_MATRIX_SAMPLES,
    Number.isFinite(minimumSamples) ? minimumSamples : MIN_MATRIX_SAMPLES
  );
  const definition = getTradeStrategyDefinition({
    strategy_id: strategyId,
    strategy_name: strategyName
  });
  const baselineTargets = getEffectiveTargetBaseline(
    definition,
    assetTier
  );
  const model = createDeterministicModel({
    targetScope: TARGET_SCOPE,
    sampleSize,
    strategyId,
    strategyName,
    assetTier,
    generatedAt,
    baselineTargets
  });

  model.version_metadata = getVersionMetadata(trades || []);
  model.minimum_sample_required = enforcedMinimumSamples;
  const sampleSources = countTradesBySource(trades);
  const resolvedPaperTrades =
    sampleSources[OPTIMIZATION_SOURCE.PAPER] || 0;
  model.sample_sources = sampleSources;
  model.promotion_guard = {
    automatic_promotion: false,
    rollout_mode: definition?.rolloutMode || 'UNRESOLVED',
    resolved_paper_trades: resolvedPaperTrades,
    minimum_resolved_paper_trades:
      STRATEGY_PROMOTION_POLICY.minimumResolvedPaperTrades,
    minimum_strategy_tier_outcomes:
      STRATEGY_PROMOTION_POLICY.minimumStrategyTierOutcomes,
    eligible_for_manual_review:
      definition?.rolloutMode === ROLLOUT_MODE.PAPER_ONLY &&
      resolvedPaperTrades >=
        STRATEGY_PROMOTION_POLICY.minimumResolvedPaperTrades &&
      sampleSize >=
        STRATEGY_PROMOTION_POLICY.minimumStrategyTierOutcomes
  };
  model.shrinkage = {
    method: 'empirical-bayes-to-deterministic-baseline',
    prior_strength: SHRINKAGE_PRIOR_STRENGTH
  };
  model.dynamic_trailing = buildRegimeTrailingProposals(
    trades,
    strategyName,
    assetTier,
    enforcedMinimumSamples
  );
  model.trailing_learning_applied = hasActiveTrailingProposal(
    model.dynamic_trailing
  );

  if (sampleSize < enforcedMinimumSamples) {
    model.sample_quality = {
      usable: sampleSize,
      sl_evidence: 0,
      tp_evidence: 0,
      t_hold_evidence: 0
    };
    return model;
  }

  const winningTrades = trades.filter(trade => trade.status === 'WIN');
  const losingTrades = trades.filter(trade => trade.status === 'LOSS');

  // Regime-weighted estimation: partition trades by regime bucket
  const regimeBuckets = new Map();
  for (const trade of trades) {
    const bucket = classifyRegimeBucket(trade.regime_at_entry);
    if (!regimeBuckets.has(bucket)) {
      regimeBuckets.set(bucket, { wins: [], losses: [] });
    }
    const group = regimeBuckets.get(bucket);
    if (trade.status === 'WIN') group.wins.push(trade);
    else group.losses.push(trade);
  }

  // Compute per-bucket estimates when bucket has >= 5 trades
  const bucketEstimates = new Map();
  for (const [bucketName, { wins, losses }] of regimeBuckets) {
    const bucketTotal = wins.length + losses.length;
    if (bucketTotal < 5) continue;
    bucketEstimates.set(bucketName, {
      sl: calculateSlEstimate(wins, losses, baselineTargets.slMult),
      tp: calculateTpEstimate(losses, wins, baselineTargets.tpMult),
      hold: calculateHoldEstimate(wins, losses, baselineTargets.tHold_modifier),
      weight: bucketTotal
    });
  }

  // If we have regime-partitioned data, blend estimates weighted by sample count
  let sl, tp, hold;
  if (bucketEstimates.size >= 2) {
    const totalWeight = [...bucketEstimates.values()]
      .reduce((sum, b) => sum + b.weight, 0);
    const blendEstimate = (field) => {
      let weightedSum = 0;
      let weightedEvidence = 0;
      for (const [, bucket] of bucketEstimates) {
        const w = bucket.weight / totalWeight;
        weightedSum += bucket[field].estimate * w;
        weightedEvidence += bucket[field].evidenceCount * w;
      }
      return { estimate: weightedSum, evidenceCount: Math.round(weightedEvidence) };
    };
    sl = blendEstimate('sl');
    tp = blendEstimate('tp');
    hold = blendEstimate('hold');
  } else {
    // Fallback: aggregate estimation (no regime split)
    sl = calculateSlEstimate(
      winningTrades,
      losingTrades,
      baselineTargets.slMult
    );
    tp = calculateTpEstimate(
      losingTrades,
      winningTrades,
      baselineTargets.tpMult
    );
    hold = calculateHoldEstimate(
      winningTrades,
      losingTrades,
      baselineTargets.tHold_modifier
    );
  }

  const optimized = {
    slMult: round(clamp(shrinkTowardBaseline(
      sl.estimate,
      baselineTargets.slMult,
      sl.evidenceCount
    ),
    STRATEGY_TARGET_LIMITS.slMult.minimum,
    STRATEGY_TARGET_LIMITS.slMult.maximum)),
    tpMult: round(clamp(shrinkTowardBaseline(
      tp.estimate,
      baselineTargets.tpMult,
      tp.evidenceCount
    ),
    STRATEGY_TARGET_LIMITS.tpMult.minimum,
    STRATEGY_TARGET_LIMITS.tpMult.maximum)),
    tHold_modifier: round(clamp(shrinkTowardBaseline(
      hold.estimate,
      baselineTargets.tHold_modifier,
      hold.evidenceCount
    ),
    STRATEGY_TARGET_LIMITS.tHoldModifier.minimum,
    STRATEGY_TARGET_LIMITS.tHoldModifier.maximum))
  };

  model.dynamic_targets.optimized = optimized;
  model.learning_applied =
    Object.keys(optimized).some(
      key => optimized[key] !== baselineTargets[key]
    );
  model.sample_quality = {
    usable: sampleSize,
    wins: winningTrades.length,
    losses: losingTrades.length,
    sl_evidence: sl.evidenceCount,
    tp_evidence: tp.evidenceCount,
    t_hold_evidence: hold.evidenceCount
  };

  return model;
};

export const buildOptimizationModel = (
  allTrades,
  { generatedAt = new Date().toISOString() } = {}
) => {
  const {
    usable,
    rejected,
    rejectionCounts
  } = partitionUsableTrades(allTrades);
  const globalFallback = createDeterministicModel({
    sampleSize: usable.length,
    generatedAt
  });

  const model = {
    optimizer_version: OPTIMIZER_VERSION,
    model_schema_version: MODEL_SCHEMA_VERSION,
    training_data_fingerprint: calculateTrainingFingerprint(usable),
    target_scope: TARGET_SCOPE,
    target_baseline_semantics: STRATEGY_TARGET_BASELINE_SEMANTICS,
    generated_at: generatedAt,
    sample_size: usable.length,
    rejected_sample_size: rejected.length,
    rejection_counts: rejectionCounts,
    policy: {
      learned_parameters: [
        'tpMult',
        'slMult',
        'tHold_modifier',
        'beTrigger',
        'lockTrigger',
        'lockAmount',
        'trailTrigger',
        'trailDist'
      ],
      prohibited_parameters: [
        'gate_weights',
        'gate_thresholds',
        'minScore',
        'risk_sizing',
        'suggested_risk_pct',
        'entry_penalty',
        'rolloutMode',
        'promotion_status'
      ],
      minimum_matrix_samples: MIN_MATRIX_SAMPLES,
      shrinkage_prior_strength: SHRINKAGE_PRIOR_STRENGTH,
      automatic_strategy_promotion: false,
      promotion_review_thresholds: {
        ...STRATEGY_PROMOTION_POLICY
      }
    },
    // These deterministic fallbacks preserve the existing consumer contract.
    global: globalFallback,
    tiers: {},
    strategies: {},
    matrix: {},
    matrix_by_id: {},
    matrix_index: {},
    source_counts: {
      usable: countTradesBySource(usable),
      rejected: countTradesBySource(
        rejected.map(item => item.trade)
      )
    }
  };

  const tierNames = [...new Set(
    usable.map(trade => String(trade.asset_tier).trim())
  )];
  for (const tier of tierNames) {
    model.tiers[tier] = createDeterministicModel({
      targetScope: 'deterministic-tier-fallback',
      sampleSize: usable.filter(
        trade => String(trade.asset_tier).trim() === tier
      ).length,
      assetTier: tier,
      generatedAt
    });
  }

  const groups = new Map();
  for (const trade of usable) {
    const strategyId = getStableStrategyId(trade);
    const assetTier = String(trade.asset_tier).trim();
    const tierId = getStableTierId(assetTier);
    const stableKey = `${strategyId}|${tierId}`;
    const strategyName = cleanStrategyName(trade.strategy_name);

    if (!groups.has(stableKey)) {
      groups.set(stableKey, {
        strategyId,
        strategyName,
        assetTier,
        tierId,
        trades: []
      });
    }

    const group = groups.get(stableKey);
    group.trades.push(trade);

    // Prefer the display label from the most recently observed trade.
    const currentTimestamp = Date.parse(
      group.latestObservedAt || ''
    );
    const tradeTimestamp = Date.parse(
      trade.close_time || trade.created_at || ''
    );
    if (
      !Number.isFinite(currentTimestamp) ||
      (Number.isFinite(tradeTimestamp) && tradeTimestamp >= currentTimestamp)
    ) {
      group.strategyName = strategyName;
      group.latestObservedAt =
        trade.close_time || trade.created_at || group.latestObservedAt;
    }
  }

  for (const [stableKey, group] of groups) {
    const cell = analyzeStrategyTierCell(group.trades, {
      strategyId: group.strategyId,
      strategyName: group.strategyName,
      assetTier: group.assetTier,
      generatedAt
    });
    const legacyKey = `${group.strategyName}|${group.assetTier}`;

    model.matrix_by_id[stableKey] = cell;
    model.matrix[legacyKey] = cell;
    model.matrix_index[legacyKey] = stableKey;
  }

  // BTC context summary for downstream consumers
  const btcContextTrades = usable.filter(trade =>
    String(trade.btc_regime_at_entry || '').trim()
  );
  const regimeCounts = {
    [BTC_REGIME.BULLISH_TREND]: 0,
    [BTC_REGIME.BEARISH_TREND]: 0,
    [BTC_REGIME.RANGE]: 0,
    [BTC_REGIME.SIDEWAYS]: 0,
    [BTC_REGIME.UNKNOWN]: 0
  };
  for (const trade of btcContextTrades) {
    regimeCounts[classifyBtcRegime(trade.btc_regime_at_entry)] += 1;
  }
  const classifiedContextSampleSize =
    btcContextTrades.length - regimeCounts[BTC_REGIME.UNKNOWN];
  const btcTrending =
    regimeCounts[BTC_REGIME.BULLISH_TREND] +
    regimeCounts[BTC_REGIME.BEARISH_TREND];
  const btcRanging =
    regimeCounts[BTC_REGIME.RANGE] +
    regimeCounts[BTC_REGIME.SIDEWAYS];
  const classifiedShare = count =>
    classifiedContextSampleSize > 0
      ? round(count / classifiedContextSampleSize)
      : null;
  const regimeDiversity = Object.entries(regimeCounts).filter(
    ([regime, count]) => regime !== BTC_REGIME.UNKNOWN && count > 0
  ).length;
  model.btc_context_summary = {
    btc_trending_trade_pct: classifiedShare(btcTrending),
    btc_ranging_trade_pct: classifiedShare(btcRanging),
    btc_bullish_trade_pct: classifiedShare(
      regimeCounts[BTC_REGIME.BULLISH_TREND]
    ),
    btc_bearish_trade_pct: classifiedShare(
      regimeCounts[BTC_REGIME.BEARISH_TREND]
    ),
    btc_range_trade_pct: classifiedShare(
      regimeCounts[BTC_REGIME.RANGE]
    ),
    btc_sideways_trade_pct: classifiedShare(
      regimeCounts[BTC_REGIME.SIDEWAYS]
    ),
    btc_regime_counts: regimeCounts,
    btc_regime_diversity: regimeDiversity,
    btc_context_sample_size: btcContextTrades.length,
    btc_classified_context_sample_size: classifiedContextSampleSize,
    btc_unknown_regime_sample_size:
      regimeCounts[BTC_REGIME.UNKNOWN],
    btc_missing_context_sample_size:
      usable.length - btcContextTrades.length
  };

  return {
    model,
    usableTrades: usable,
    rejectedTrades: rejected
  };
};

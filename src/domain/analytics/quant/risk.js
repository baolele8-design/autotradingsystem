import {
  getStrategyDefinition,
  routeStrategy
} from '../../trading/strategyRouter.js';
import {
  getStrategyTierTargetModifiers,
  STRATEGY_TARGET_BASELINE_SEMANTICS,
  STRATEGY_TARGET_LIMITS,
  STRATEGY_TARGET_SCOPE,
  STRATEGY_TIER_MIN_SAMPLES
} from '../../trading/strategyOptimizationPolicy.js';

const INTERVAL_HOURS = Object.freeze({
  '5m': 5 / 60,
  '15m': 15 / 60,
  '1h': 1,
  '4h': 4,
  '1d': 24
});

const finiteOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

export const costDrag = (
  entryPrice,
  tradeType,
  direction,
  entryExecution,
  exitExecution,
  fundingRate,
  spreadPercent,
  holdingCycles = 1,
  makerFee = 0.0002,
  takerFee = 0.0004,
  interval = '1h',
  obi = 0.5
) => {
  let slippagePenalty = 0;
  if (entryExecution === 'MARKET') {
    if (direction === 'LONG' && obi < 0.4) slippagePenalty = 0.0015;
    if (direction === 'SHORT' && obi > 0.6) slippagePenalty = 0.0015;
  }

  const entrySlippage =
    entryExecution === 'MARKET' ? 0.001 + slippagePenalty : 0;
  const entryFee = entryExecution === 'MARKET' ? takerFee : makerFee;
  const exitSlippage = exitExecution === 'MARKET' ? 0.001 : 0;
  const exitFee = exitExecution === 'MARKET' ? takerFee : makerFee;
  const spreadCost = finiteOr(spreadPercent, 0) / 100 / 2;
  const totalHoldingHours =
    finiteOr(holdingCycles, 1) * (INTERVAL_HOURS[interval] || 1);
  const fundingCycles = totalHoldingHours / 8;

  let fundingImpact = 0;
  if (tradeType === 'FUTURES') {
    fundingImpact = direction === 'LONG'
      ? finiteOr(fundingRate, 0) * fundingCycles
      : -finiteOr(fundingRate, 0) * fundingCycles;
  }

  const entryCostPerCoin =
    (entrySlippage + entryFee + spreadCost) * entryPrice;
  const exitCostPerCoin =
    (exitSlippage + exitFee + spreadCost) * entryPrice;
  return entryCostPerCoin + exitCostPerCoin + fundingImpact * entryPrice;
};

export const trueEV = (winRate, reward, lossRate, risk) =>
  winRate * reward - lossRate * risk;

export const kellyCriterion = (
  winRate,
  historicalAvgRR,
  nTrades = 0,
  atrRank = 50
) => {
  if (nTrades < 5) return 0.02;
  if (winRate === 0 || historicalAvgRR === 0) return 0.01;

  const fullKelly = winRate - (1 - winRate) / historicalAvgRR;
  let halfKelly = Math.max(0, fullKelly * 0.5);
  if (nTrades < 30) {
    halfKelly *= Math.max(0.15, nTrades / 30);
  }

  return halfKelly * Math.exp(-(atrRank / 100));
};

function isLearnedStrategyTierModel(model) {
  return Boolean(
    model &&
    model.target_scope === STRATEGY_TARGET_SCOPE &&
    model.target_baseline_semantics ===
      STRATEGY_TARGET_BASELINE_SEMANTICS &&
    model.learning_applied === true &&
    finiteOr(model.sample_size, 0) >= STRATEGY_TIER_MIN_SAMPLES
  );
}

function getExecutionPlan(strategy, autoData, vectorDetails, direction) {
  const price = finiteOr(autoData.currentPrice, 0);
  const atr = Math.max(0, finiteOr(autoData.atr14, 0));
  const sign = direction === 'LONG' ? 1 : -1;
  const marketFamilies = new Set([
    'STRUCTURAL_BREAKOUT',
    'POSITION_CONTINUATION'
  ]);

  if (!strategy.isFallback) {
    if (
      marketFamilies.has(strategy.family) ||
      strategy.strategyId === 'FLOW_REACCELERATION' ||
      strategy.strategyId === 'ALT_CAPITAL_ROTATION'
    ) {
      return { execType: 'MARKET', suggestedEntry: price };
    }

    const entryAtrOffset =
      strategy.strategyId === 'VALUE_AREA_TREND_PULLBACK' ? -0.25 : 0;
    return {
      execType: 'LIMIT',
      suggestedEntry: price + sign * entryAtrOffset * atr
    };
  }

  const l1 = String(vectorDetails?.l1 || '');
  if (
    direction === 'LONG' &&
    l1.includes('Strong Trend')
  ) {
    return { execType: 'MARKET', suggestedEntry: price };
  }
  if (direction === 'LONG' && l1.includes('Trend')) {
    return {
      execType: 'LIMIT',
      suggestedEntry: price - 0.5 * atr
    };
  }
  if (direction === 'LONG') {
    return {
      execType: 'LIMIT',
      suggestedEntry: price - 0.8 * atr
    };
  }
  if (l1.includes('Strong Trend Up') || l1.includes('Trend Up')) {
    return {
      execType: 'LIMIT',
      suggestedEntry: price + 0.8 * atr
    };
  }
  return { execType: 'MARKET', suggestedEntry: price };
}

/**
 * Routes the signal first, then applies a matching strategy×tier target cell.
 * Model output cannot alter route conditions, direction, score weights or risk.
 */
export const dynamicAsymmetricTargets = (
  autoData,
  apiMacro,
  vectorDetails,
  direction,
  targetModel,
  assetTier = 'Tier 2',
  preselectedStrategy = null,
  context = {}
) => {
  const selected =
    preselectedStrategy?.strategyId
      ? preselectedStrategy
      : routeStrategy({
          autoData,
          apiMacro,
          vectorDetails,
          direction,
          assetTier,
          symbol: context.symbol || autoData?.symbol || ''
        });
  const profile = selected.profile ||
    getStrategyDefinition(selected.strategyId)?.profile ||
    { slMult: 1.5, tpMult: 3, holdingCycles: 6, minScore: 50 };
  const learnedModelApplied = isLearnedStrategyTierModel(targetModel);
  const optimized = learnedModelApplied
    ? targetModel.dynamic_targets?.optimized
    : null;
  const tierModifiers = getStrategyTierTargetModifiers(assetTier);
  const deterministicSlMult = profile.slMult * tierModifiers.sl;
  const deterministicTpMult = profile.tpMult * tierModifiers.tp;
  const volatilityBuffer =
    finiteOr(autoData?.atrPercent, 0) > 2 ? 0.2 : 0;

  // A strategy-tier cell stores final ATR targets for that tier. The live
  // volatility buffer remains a deterministic post-processing step in both
  // branches, so learning tHold (or only one target) cannot move another
  // target by merely switching branches.
  let slMult = (
    optimized
      ? finiteOr(optimized.slMult, deterministicSlMult)
      : deterministicSlMult
  ) + volatilityBuffer;
  let tpMult = optimized
    ? finiteOr(optimized.tpMult, deterministicTpMult)
    : deterministicTpMult;
  slMult = clamp(
    slMult,
    STRATEGY_TARGET_LIMITS.slMult.minimum,
    STRATEGY_TARGET_LIMITS.slMult.maximum
  );
  tpMult = clamp(
    Math.max(tpMult, slMult * 1.5),
    STRATEGY_TARGET_LIMITS.tpMult.minimum,
    STRATEGY_TARGET_LIMITS.tpMult.maximum
  );

  const tHoldModifier = optimized
    ? clamp(
        finiteOr(optimized.tHold_modifier, 1),
        STRATEGY_TARGET_LIMITS.tHoldModifier.minimum,
        STRATEGY_TARGET_LIMITS.tHoldModifier.maximum
      )
    : 1;
  const execution = getExecutionPlan(
    selected,
    autoData || {},
    vectorDetails || {},
    direction
  );

  return {
    ...execution,
    strategyId: selected.strategyId,
    strategyName: selected.strategyId,
    strategyDisplayName: selected.displayName,
    strategyVersion: 1,
    family: selected.family,
    rolloutMode: selected.rolloutMode,
    executionMode: selected.rolloutMode,
    policy: selected.policy,
    profile,
    minScore: profile.minScore,
    routeDiagnostics: selected.diagnostics,
    isFallback: selected.isFallback,
    modelApplied: learnedModelApplied,
    modelSampleSize: learnedModelApplied
      ? finiteOr(targetModel.sample_size, 0)
      : 0,
    slMult,
    tpMult,
    tHoldModifier
  };
};

export const estimateLiquidation = (
  notionalUSD,
  leverage,
  entry,
  direction,
  brackets
) => {
  if (!brackets || brackets.length === 0 || !leverage) return null;
  const tier = brackets.find(
    bracket =>
      notionalUSD >= bracket.notionalFloor &&
      notionalUSD < bracket.notionalCap
  ) || brackets[brackets.length - 1];
  const mmr = tier.maintMarginRatio;
  const liqPrice = direction === 'LONG'
    ? entry * (1 - 1 / leverage + mmr)
    : entry * (1 + 1 / leverage - mmr);

  return {
    liqPrice,
    mmr,
    maxLevForTier: tier.initialLeverage,
    bracket: tier.bracket
  };
};

export const classifyAssetTier = (
  symbol,
  usdVolume24h,
  realSpreadPct
) => {
  const tier1Macros = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
  if (tier1Macros.includes(symbol)) return 'Tier 1: Macro';
  if (usdVolume24h >= 30_000_000 && realSpreadPct <= 0.015) {
    return 'Tier 2: Liquid Majors';
  }
  if (usdVolume24h >= 8_000_000 && realSpreadPct <= 0.040) {
    return 'Tier 3: Mid-Cap Equities';
  }
  return 'Tier 4: Nano/High-Risk';
};

function getLegacyHoldingCycles(_strategyId) {
  // Legacy strategies no longer exist; new strategies always provide
  // holdingCycles via their catalog profile.  This fallback returns a
  // safe default for any historical trades that lack a profile.
  return 6;
}

export const calculateTemporalBarrier = (
  interval,
  tradeType,
  direction,
  vectorDetails,
  assetTier,
  currentHourUTC,
  strategy = '',
  tHoldModifier = 1,
  btcTrendAlignment = null
) => {
  const strategyId = typeof strategy === 'string'
    ? strategy
    : strategy?.strategyId || '';
  const definition =
    (typeof strategy === 'object' && strategy?.profile)
      ? strategy
      : getStrategyDefinition(strategyId);
  let baseCycles = finiteOr(
    definition?.profile?.holdingCycles,
    getLegacyHoldingCycles(strategyId)
  );

  // Regime-adaptive hold modifier: continuous scaling replaces fixed ±1 step.
  // Range regimes decay fastest (chop = time-decay risk),
  // Extreme/Compression regimes are trimmed moderately,
  // Expansion (breakout) regimes get a slight trim.
  let regimeModifier = 1;
  const regime = vectorDetails?.l2;
  if (regime === 'Range') {
    regimeModifier = 0.75;
  } else if (regime === 'Extreme' || regime === 'Compression') {
    regimeModifier = 0.80;
  } else if (regime === 'Expansion') {
    regimeModifier = 0.85;
  }

  const tier = String(assetTier || '');
  let tierModifier = 1;
  if (tier.includes('Tier 1') || tier.includes('Tier 2')) {
    tierModifier = 1.2;
  } else if (tier.includes('Tier 4')) {
    tierModifier = 0.7;
  }

  let sessionModifier = 1;
  if (interval === '5m' || interval === '15m') {
    if (currentHourUTC >= 13 && currentHourUTC <= 21) {
      sessionModifier = 0.8;
    } else if (currentHourUTC >= 0 && currentHourUTC <= 7) {
      sessionModifier = 1.2;
    }
  }

  const optimizedHoldingModifier = clamp(
    finiteOr(tHoldModifier, 1),
    STRATEGY_TARGET_LIMITS.tHoldModifier.minimum,
    STRATEGY_TARGET_LIMITS.tHoldModifier.maximum
  );

  // BTC trend modifier for altcoins:
  // Counter-BTC trades get shortened, aligned trades get extended.
  let btcModifier = 1;
  if (btcTrendAlignment === false) btcModifier = 0.85;
  else if (btcTrendAlignment === true) btcModifier = 1.10;

  const maxHoldingCycles = Math.round(
    baseCycles *
    regimeModifier *
    sessionModifier *
    tierModifier *
    optimizedHoldingModifier *
    btcModifier
  );
  return clamp(maxHoldingCycles, 2, 16);
};

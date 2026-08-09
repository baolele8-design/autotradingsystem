import {
  calculateTrailingDecision,
  normalizeProtectionStage
} from '../../../../src/domain/trading/trailingPolicy.js';
import { calculateTemporalBarrier } from '../../../../src/domain/analytics/quant/risk.js';

export const SCALP_STRATEGY_FAMILY_MAP = Object.freeze({
  S1_EMA_MOMENTUM: 'TREND_CONTINUATION',
  S2_RSI_SNAP: 'MEAN_REVERSION',
  S3_BB_SQUEEZE: 'STRUCTURAL_BREAKOUT'
});

export function getScalpStrategyFamily(strategyId) {
  return SCALP_STRATEGY_FAMILY_MAP[strategyId] || strategyId || 'TREND_CONTINUATION';
}

export function calculateScalpTrailingDecision({
  entryPrice,
  currentSl,
  markPrice,
  initialRiskPerCoin,
  direction,
  storedHighWater = null,
  protectionStage = 'NONE',
  strategyId = 'S1_EMA_MOMENTUM',
  assetTier = 'Tier 2'
}) {
  const mappedFamily = getScalpStrategyFamily(strategyId);

  const decision = calculateTrailingDecision({
    entryPrice,
    currentSl,
    markPrice,
    initialRiskPerCoin,
    direction,
    storedHighWater,
    protectionStage,
    strategyName: mappedFamily,
    assetTier
  });

  return {
    ...decision,
    strategyId,
    mappedFamily
  };
}

export function calculateScalpTemporalBarrier({
  interval = '5m',
  tradeType = 'FUTURES',
  direction = 'LONG',
  vectorDetails = null,
  assetTier = 'Tier 2',
  currentHourUTC = new Date().getUTCHours(),
  strategyId = 'S1_EMA_MOMENTUM',
  tHoldModifier = 1,
  btcTrendAlignment = null,
  protectionStage = 'NONE',
  currentProfitR = 0,
  highWaterR = 0
}) {
  const mappedFamily = getScalpStrategyFamily(strategyId);

  let baseHoldingCycles = calculateTemporalBarrier(
    interval,
    tradeType,
    direction,
    vectorDetails,
    assetTier,
    currentHourUTC,
    mappedFamily,
    tHoldModifier,
    btcTrendAlignment
  );

  const stage = normalizeProtectionStage(protectionStage);
  const isLockOrTrail = stage === 'LOCK' || stage === 'TRAIL';
  const effectiveR = Math.max(
    Number.isFinite(currentProfitR) ? currentProfitR : 0,
    Number.isFinite(highWaterR) ? highWaterR : 0
  );

  let softExtensionApplied = false;
  let maxHoldingCycles = baseHoldingCycles;

  if (isLockOrTrail && effectiveR >= 1.5) {
    maxHoldingCycles = Math.round(baseHoldingCycles * 1.25);
    softExtensionApplied = true;
  }

  return {
    maxHoldingCycles,
    baseHoldingCycles,
    softExtensionApplied,
    mappedFamily,
    protectionStage: stage,
    effectiveR
  };
}

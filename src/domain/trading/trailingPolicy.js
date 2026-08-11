export const PROTECTION_STAGE_RANK = Object.freeze({
    NONE: 0,
    BE: 1,
    LOCK: 2,
    TRAIL: 3
});

// UNIFIED TRAILING SCHEDULE (owner directive 2026-08-11):
// ONE schedule for EVERY strategy, asset tier and regime —
//   BE 0.2R / LOCK 0.4R locking +0.2R / TRAIL 0.6R trailing 0.2R.
// Family profiles, keyword fallbacks, tier offsets and regime buckets are
// deliberately removed; every cell resolves to this single schedule and the
// optimizer can never override it (see isPinnedTrailingPolicyCell and
// resolveOptimizedTrailingPolicy). History is recorded in AGENTS.md §6.
const UNIFIED_TRAILING_SCHEDULE = Object.freeze({
  beTrigger: 0.2,
  lockTrigger: 0.4,
  lockAmount: 0.2,
  trailTrigger: 0.6,
  trailDist: 0.2
});

export function isPinnedTrailingPolicyCell() {
  return true;
}

export function normalizeProtectionStage(stage) {
    const normalized = String(stage || 'NONE').toUpperCase();
    return Object.hasOwn(PROTECTION_STAGE_RANK, normalized)
        ? normalized
        : 'NONE';
}

const isValidTrailingPolicy = policy => {
  const values = [
    policy?.beTrigger,
    policy?.lockTrigger,
    policy?.lockAmount,
    policy?.trailTrigger,
    policy?.trailDist
  ];
  return (
    values.every(Number.isFinite) &&
    policy.beTrigger > 0 &&
    policy.lockTrigger > policy.beTrigger &&
    policy.lockAmount >= 0 &&
    policy.lockAmount < policy.lockTrigger &&
    policy.trailTrigger > policy.lockTrigger &&
    policy.trailDist > 0
  );
};

export function resolveOptimizedTrailingPolicy(
  model,
  strategyName,
  assetTier,
  regimeAtEntry,
  btcRegimeAtEntry
) {
  // Unified schedule (directive 2026-08-07): every cell is pinned, so no
  // saved optimizer model — including stale pre-deploy rows — can ever
  // override the schedule at runtime. Fails closed unconditionally.
  return null;
}

export function getTrailingPolicy(strategyName = '', assetTier = '') {
  // Unified schedule (directive 2026-08-07): the same schedule for every
  // strategy, tier and regime. No family catalog, keyword fallback or tier
  // offset is applied.
  return { ...UNIFIED_TRAILING_SCHEDULE };
}

export function calculateTrailingDecision({
    entryPrice,
    currentSl,
    markPrice,
    initialRiskPerCoin,
    direction,
    storedHighWater,
    protectionStage = 'NONE',
    strategyName = '',
    assetTier = '',
    policyOverride = null
}) {
    const values = [
        entryPrice,
        currentSl,
        markPrice,
        initialRiskPerCoin
    ];

    if (
        values.some(value => !Number.isFinite(value)) ||
        entryPrice <= 0 ||
        currentSl <= 0 ||
        markPrice <= 0 ||
        initialRiskPerCoin <= 0
    ) {
        throw new Error('Invalid numeric input for trailing decision');
    }

    const isLong = String(direction).toUpperCase() === 'LONG';
    const safeStoredHighWater = Number.isFinite(storedHighWater)
        ? storedHighWater
        : entryPrice;
    const highWaterPrice = isLong
        ? Math.max(safeStoredHighWater, markPrice)
        : Math.min(safeStoredHighWater, markPrice);
    const currentProfit = isLong
        ? markPrice - entryPrice
        : entryPrice - markPrice;
    const highWaterProfit = isLong
        ? highWaterPrice - entryPrice
        : entryPrice - highWaterPrice;
    const currentProfitR = currentProfit / initialRiskPerCoin;
    const highWaterR = highWaterProfit / initialRiskPerCoin;
    const baselinePolicy = getTrailingPolicy(strategyName, assetTier);
    const policy = isValidTrailingPolicy(policyOverride)
        ? { ...policyOverride }
        : baselinePolicy;

    const currentStage = normalizeProtectionStage(protectionStage);
    let nextStage = currentStage;

    if (
        PROTECTION_STAGE_RANK[currentStage] >= PROTECTION_STAGE_RANK.TRAIL ||
        highWaterR >= policy.trailTrigger
    ) {
        nextStage = 'TRAIL';
    } else if (
        PROTECTION_STAGE_RANK[currentStage] >= PROTECTION_STAGE_RANK.LOCK ||
        highWaterR >= policy.lockTrigger
    ) {
        nextStage = 'LOCK';
    } else if (
        PROTECTION_STAGE_RANK[currentStage] >= PROTECTION_STAGE_RANK.BE ||
        highWaterR >= policy.beTrigger
    ) {
        nextStage = 'BE';
    }

    let targetSl = currentSl;
    let triggerReason = '';

    if (nextStage === 'TRAIL') {
        targetSl = isLong
            ? highWaterPrice - initialRiskPerCoin * policy.trailDist
            : highWaterPrice + initialRiskPerCoin * policy.trailDist;
        triggerReason = `TRAIL ${policy.trailDist.toFixed(2)}R`;
    } else if (nextStage === 'LOCK') {
        targetSl = isLong
            ? entryPrice + initialRiskPerCoin * policy.lockAmount
            : entryPrice - initialRiskPerCoin * policy.lockAmount;
        triggerReason = `LOCK +${policy.lockAmount.toFixed(2)}R`;
    } else if (nextStage === 'BE') {
        const beBufferR = 0.05;
        targetSl = isLong
            ? entryPrice + initialRiskPerCoin * beBufferR
            : entryPrice - initialRiskPerCoin * beBufferR;
        triggerReason = `BE +${beBufferR.toFixed(2)}R`;
    }

    return {
        isLong,
        currentProfitR,
        highWaterPrice,
        highWaterR,
        currentStage,
        nextStage,
        targetSl,
        triggerReason,
        policy
    };
}

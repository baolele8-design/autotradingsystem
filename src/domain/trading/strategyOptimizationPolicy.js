export const STRATEGY_TARGET_SCOPE = 'strategy-tier';
export const STRATEGY_TIER_MIN_SAMPLES = 15;
export const STRATEGY_TARGET_BASELINE_SEMANTICS =
  'effective-strategy-tier/v2';

export const STRATEGY_TARGET_LIMITS = Object.freeze({
  slMult: Object.freeze({ minimum: 0.8, maximum: 3.5 }),
  // B3 (TP1 ~1R): tpMult không còn được học 2.5R+; tối đa 2.0 chặn
  // retrain quay lại khoảng cách TP cũ, tối thiểu 1.0 cho phép TP ≤ SL.
  tpMult: Object.freeze({ minimum: 1.0, maximum: 2.0 }),
  tHoldModifier: Object.freeze({ minimum: 0.5, maximum: 2 })
});

export const STRATEGY_PROMOTION_POLICY = Object.freeze({
  minimumShadowSignals: 100,
  minimumResolvedPaperTrades: 30,
  minimumStrategyTierOutcomes: STRATEGY_TIER_MIN_SAMPLES
});

export function getStrategyTierTargetModifiers(assetTier) {
  const tier = String(assetTier || '');
  if (tier.includes('Tier 1') || tier.includes('Tier 2')) {
    // B3 (TP1 ~1R): tp modifier 0.85 → 1.10 — TP tier-1/2 không còn bị
    // kéo xuống dưới baseline deterministic.
    return Object.freeze({ sl: 1.10, tp: 1.10 });
  }
  if (tier.includes('Tier 3')) {
    return Object.freeze({ sl: 1.0, tp: 1.0 });
  }
  if (tier.includes('Tier 4')) {
    return Object.freeze({ sl: 1.15, tp: 1.15 });
  }
  return Object.freeze({ sl: 1, tp: 1 });
}

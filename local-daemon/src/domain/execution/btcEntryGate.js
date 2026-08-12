// BTC entry gate: blocks SHORT entries on Tier 1/2 altcoins while BTC is in a
// downtrend. Data basis: report 35 (closed-only, n=30 Downtrend x SHORT:
// WR 43.3% [27.4, 60.8], avgR -0.190 [-0.363, -0.018], PnL -$43.79 across
// Tier 1/2 Liquid Majors). LONG is NOT gated (Downtrend x LONG was net
// positive, +$2.27, n=3). BTCUSDT is never gated. Unknown regime passes
// with a warning (fail-open, limited to warn logging).

const BEARISH_REGIMES = new Set([
  'DOWNTREND',
  'STRONG_TREND_DOWN',
  'BEARISH_TREND'
]);

// avgR of the blocked cell (Downtrend x SHORT, closed-only, report 35).
const SHORT_DOWNTREND_EST_AVG_R = -0.19;

const tierBlocked = assetTier => {
  const tier = String(assetTier || '');
  return tier.includes('Tier 1') || tier.includes('Tier 2');
};

export const evaluateBtcEntryGate = ({
  direction,
  assetTier,
  btcRegime,
  symbol = ''
}) => {
  const normalized = String(btcRegime || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/gu, '_');

  if (String(symbol).toUpperCase() === 'BTCUSDT') {
    return { blocked: false, reason: null, warn: false };
  }
  if (!BEARISH_REGIMES.has(normalized)) {
    return {
      blocked: false,
      reason: null,
      warn: true,
      regime: normalized || 'UNKNOWN'
    };
  }
  if (direction !== 'SHORT') {
    return { blocked: false, reason: null, warn: false, regime: normalized };
  }
  if (!tierBlocked(assetTier)) {
    return { blocked: false, reason: null, warn: false, regime: normalized };
  }

  return {
    blocked: true,
    reason: 'BTC_DOWNTREND_SHORT_GATE',
    warn: false,
    regime: normalized,
    estimatedAvgR: SHORT_DOWNTREND_EST_AVG_R
  };
};

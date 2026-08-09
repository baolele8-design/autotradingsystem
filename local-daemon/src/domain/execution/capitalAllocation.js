export function calculateMainBotAllocation({
  walletBalance,
  baseCapitalUsd,
  baseMaxTotalUsd,
  baseRefillUsd,
  baseFixedSizeUsd
}) {
  const capital = Number.parseFloat(walletBalance);
  const baseCapital = Number.parseFloat(baseCapitalUsd);

  if (!Number.isFinite(capital) || capital <= 0) {
    throw new TypeError('walletBalance must be a positive finite number');
  }
  if (!Number.isFinite(baseCapital) || baseCapital <= 0) {
    throw new TypeError('baseCapitalUsd must be a positive finite number');
  }

  const scale = capital / baseCapital;

  return {
    maxTotalUsd: Number.parseFloat(baseMaxTotalUsd) * scale,
    refillUsdThreshold: Number.parseFloat(baseRefillUsd) * scale,
    fixedSizeUsd: Number.parseFloat(baseFixedSizeUsd) * scale,
    scale
  };
}

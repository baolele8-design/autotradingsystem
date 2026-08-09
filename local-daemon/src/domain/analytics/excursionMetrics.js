const finitePositive = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function calculateDirectionalExcursions({
  anchorPrice,
  candles,
  direction,
  quantity
}) {
  const anchor = finitePositive(anchorPrice);
  const size = finitePositive(quantity);
  const normalizedDirection = String(direction || '').toUpperCase();
  if (
    anchor === null ||
    size === null ||
    !['LONG', 'SHORT'].includes(normalizedDirection) ||
    !Array.isArray(candles) ||
    candles.length === 0
  ) {
    return null;
  }

  let maxHigh = -Infinity;
  let minLow = Infinity;
  let maxHighIndex = 0;
  let minLowIndex = 0;

  candles.forEach((candle, index) => {
    const high = Number(candle?.[2]);
    const low = Number(candle?.[3]);
    if (Number.isFinite(high) && high > maxHigh) {
      maxHigh = high;
      maxHighIndex = index + 1;
    }
    if (Number.isFinite(low) && low < minLow) {
      minLow = low;
      minLowIndex = index + 1;
    }
  });

  if (!Number.isFinite(maxHigh) || !Number.isFinite(minLow)) return null;

  if (normalizedDirection === 'LONG') {
    return {
      favorableCandles: maxHighIndex,
      favorableUsd: Math.max(0, (maxHigh - anchor) * size),
      adverseCandles: minLowIndex,
      adverseUsd: Math.min(0, (minLow - anchor) * size)
    };
  }

  return {
    favorableCandles: minLowIndex,
    favorableUsd: Math.max(0, (anchor - minLow) * size),
    adverseCandles: maxHighIndex,
    adverseUsd: Math.min(0, (anchor - maxHigh) * size)
  };
}

import { pearsonCorrelation } from './statistics.js';

const USD_PER_MILLION = 1_000_000;
const LIQUIDATION_WINDOW_MS = 15 * 60 * 1000;
const INTERVAL_MS = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
  '1M': 2_592_000_000
};

export const AMIHUD_UNIT =
  'fractional_abs_return_per_usd_1m_turnover';

function neutralAmihudProfile() {
  return {
    rank: 50,
    ready: false,
    referenceSize: 0,
    sampleSize: 0,
    unit: AMIHUD_UNIT,
    value: 0
  };
}

function calculateAmihudWindow(returns, quoteVolumes) {
  let impactSum = 0;
  let validObservations = 0;

  for (let index = 0; index < returns.length; index += 1) {
    const absoluteReturn = Math.abs(Number(returns[index]));
    const quoteVolumeUsd = Number(quoteVolumes[index]);
    if (
      !Number.isFinite(absoluteReturn) ||
      !Number.isFinite(quoteVolumeUsd) ||
      quoteVolumeUsd <= 0
    ) {
      continue;
    }

    // Classical Amihud |return| / dollar turnover, expressed per $1m.
    impactSum += absoluteReturn / (quoteVolumeUsd / USD_PER_MILLION);
    validObservations += 1;
  }

  return {
    observations: validObservations,
    value:
      validObservations > 0
        ? impactSum / validObservations
        : 0
  };
}

function midPercentileRank(value, reference) {
  if (!reference.length) return 50;

  let below = 0;
  let equal = 0;
  for (const candidate of reference) {
    const tolerance =
      Number.EPSILON *
      Math.max(1, Math.abs(value), Math.abs(candidate));
    if (candidate < value - tolerance) below += 1;
    else if (Math.abs(candidate - value) <= tolerance) equal += 1;
  }

  return Math.max(
    0,
    Math.min(
      100,
      ((below + equal * 0.5) / reference.length) * 100
    )
  );
}

function positiveFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric
    : 0;
}

function emptyLiquidationPressure(windowMs = LIQUIDATION_WINDOW_MS) {
  return {
    baselineQuoteVolumeUsd: 0,
    imbalance: 0,
    longFlushRatio: 0,
    ready: false,
    shortSqueezeRatio: 0,
    windowMs
  };
}

export const cusumFilter = (returns, threshold) => {
  if (!returns || returns.length === 0) return {
    sp: 0,
    sn: 0,
    isTriggered: false
  };
  let sp = 0;
  let sn = 0;
  let isTriggered = false;
  for (let i = 0; i < returns.length; i++) {
    sp = Math.max(0, sp + returns[i]);
    sn = Math.min(0, sn + returns[i]);
    if (sp >= threshold || sn <= -threshold) {
      isTriggered = true;
    }
  }
  return {
    sp,
    sn,
    isTriggered
  };
};

export const vpin = (buyVols, sellVols, totalVols, lookback = 50) => {
  if (!buyVols || !sellVols || !totalVols || buyVols.length < lookback) return 0;
  let orderImbalanceSum = 0;
  let totalVolumeSum = 0;
  const startIdx = buyVols.length - lookback;
  for (let i = startIdx; i < buyVols.length; i++) {
    orderImbalanceSum += Math.abs(sellVols[i] - buyVols[i]);
    totalVolumeSum += totalVols[i];
  }
  return totalVolumeSum > 0 ? orderImbalanceSum / totalVolumeSum : 0;
};

export const rollMeasure = priceDeltas => {
  if (!priceDeltas || priceDeltas.length < 3) return 0;
  let meanDelta1 = 0,
    meanDelta2 = 0;
  const n = priceDeltas.length - 1;
  let d1 = [],
    d2 = [];
  for (let i = 1; i <= n; i++) {
    d1.push(priceDeltas[i]);
    d2.push(priceDeltas[i - 1]);
    meanDelta1 += priceDeltas[i];
    meanDelta2 += priceDeltas[i - 1];
  }
  meanDelta1 /= n;
  meanDelta2 /= n;
  let covariance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (d1[i] - meanDelta1) * (d2[i] - meanDelta2);
  }
  covariance /= n - 1;
  return 2 * Math.sqrt(Math.abs(covariance));
};

/**
 * Canonical Amihud illiquidity.
 *
 * Input returns are fractional (0.01 = 1%) and turnover is quote
 * currency in USD/USDT. The result is fractional absolute return
 * per $1m of quote turnover, so 0.01 means 1% per $1m.
 */
export const amihudIlliquidity = (
  returns,
  quoteVolumes
) => {
  if (
    !Array.isArray(returns) ||
    !Array.isArray(quoteVolumes) ||
    returns.length !== quoteVolumes.length ||
    returns.length === 0
  ) {
    return 0;
  }

  return calculateAmihudWindow(returns, quoteVolumes).value;
};

export const amihudProfile = (
  returns,
  quoteVolumes,
  {
    lookback = 50,
    rankLookback = 100
  } = {}
) => {
  if (
    !Array.isArray(returns) ||
    !Array.isArray(quoteVolumes) ||
    returns.length !== quoteVolumes.length ||
    returns.length === 0
  ) {
    return neutralAmihudProfile();
  }

  const parsedLookback = Math.trunc(Number(lookback));
  const safeLookback =
    Number.isFinite(parsedLookback) && parsedLookback >= 2
      ? parsedLookback
      : 50;
  if (returns.length <= safeLookback) {
    return neutralAmihudProfile();
  }

  const current = calculateAmihudWindow(
    returns.slice(-safeLookback),
    quoteVolumes.slice(-safeLookback)
  );
  if (current.observations !== safeLookback) {
    return neutralAmihudProfile();
  }

  const reference = [];
  for (let end = safeLookback; end < returns.length; end += 1) {
    const window = calculateAmihudWindow(
      returns.slice(end - safeLookback, end),
      quoteVolumes.slice(end - safeLookback, end)
    );
    if (window.observations === safeLookback) {
      reference.push(window.value);
    }
  }

  const parsedRankLookback = Math.trunc(Number(rankLookback));
  const safeRankLookback =
    Number.isFinite(parsedRankLookback) && parsedRankLookback >= 1
      ? parsedRankLookback
      : 100;
  const rankedReference = reference.slice(-safeRankLookback);
  if (!rankedReference.length) {
    return neutralAmihudProfile();
  }

  return {
    rank: midPercentileRank(current.value, rankedReference),
    ready: true,
    referenceSize: rankedReference.length,
    sampleSize: safeLookback,
    unit: AMIHUD_UNIT,
    value: current.value
  };
};

export const liquidationPressure = ({
  avgQuoteVolumePerCandle,
  interval,
  longLiquidationUsd = 0,
  observationReady = true,
  shortLiquidationUsd = 0,
  windowMs = LIQUIDATION_WINDOW_MS
}) => {
  const candleMs = INTERVAL_MS[interval];
  const averageQuoteVolume = positiveFinite(
    avgQuoteVolumePerCandle
  );
  const requestedWindowMs = Number(windowMs);
  const safeWindowMs =
    Number.isFinite(requestedWindowMs) &&
    requestedWindowMs > 0
      ? requestedWindowMs
      : LIQUIDATION_WINDOW_MS;
  const longUsd = positiveFinite(longLiquidationUsd);
  const shortUsd = positiveFinite(shortLiquidationUsd);

  if (
    observationReady !== true ||
    !Number.isFinite(candleMs) ||
    averageQuoteVolume <= 0 ||
    !Number.isFinite(safeWindowMs)
  ) {
    return emptyLiquidationPressure(safeWindowMs);
  }

  const baselineQuoteVolumeUsd =
    averageQuoteVolume * (safeWindowMs / candleMs);
  if (
    !Number.isFinite(baselineQuoteVolumeUsd) ||
    baselineQuoteVolumeUsd <= 0
  ) {
    return emptyLiquidationPressure(safeWindowMs);
  }

  const longFlushRatio = longUsd / baselineQuoteVolumeUsd;
  const shortSqueezeRatio = shortUsd / baselineQuoteVolumeUsd;
  const liquidationScale = Math.max(longUsd, shortUsd);
  const scaledLong =
    liquidationScale > 0 ? longUsd / liquidationScale : 0;
  const scaledShort =
    liquidationScale > 0 ? shortUsd / liquidationScale : 0;
  const scaledTotal = scaledLong + scaledShort;
  const imbalance = scaledTotal > 0
    ? Math.max(
        -1,
        Math.min(
          1,
          (scaledShort - scaledLong) / scaledTotal
        )
      )
    : 0;

  return {
    baselineQuoteVolumeUsd,
    imbalance,
    longFlushRatio,
    ready: true,
    shortSqueezeRatio,
    windowMs: safeWindowMs
  };
};

export const immediateSensitivityIndicator = (altReturns, btcReturns, lagPeriods = 5) => {
  if (!altReturns || !btcReturns || altReturns.length < lagPeriods + 1) return 0;
  const corr0 = pearsonCorrelation(altReturns, btcReturns);
  let sumLagCorr = 0;
  for (let i = 1; i <= lagPeriods; i++) {
    const shiftedBtc = btcReturns.slice(0, -i);
    const currentAlt = altReturns.slice(i);
    sumLagCorr += pearsonCorrelation(currentAlt, shiftedBtc);
  }
  return corr0 - sumLagCorr / lagPeriods;
};

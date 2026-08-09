import {
  calcADX,
  calcATR,
  calcBBWidthHistory,
  calcBollingerBands,
  calcEMA,
  calcEMAArray,
  calcRSI,
  calcVolumeSMA
} from './scalpIndicators.js';

const DEFAULT_PARAMS = Object.freeze({
  S1_EMA_MOMENTUM: Object.freeze({
    min_score: 55,
    volume_threshold: 1.10,
    crossover_lookback: 2,
    rsi_long_max: 72,
    rsi_short_min: 22
  }),
  S2_RSI_SNAP: Object.freeze({
    min_score: 55,
    reversal_lookback: 3,
    rsi_oversold: 30,
    rsi_overbought: 70
  }),
  S3_BB_SQUEEZE: Object.freeze({
    min_score: 55,
    volume_threshold: 1.30,
    squeeze_percentile: 0.25,
    minimum_bbw_slope: 2
  })
});

const finite = (value, fallback = null) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

const makeDecision = (strategyId, {
  signal = null,
  reason = null,
  metrics = {}
} = {}) => ({
  strategyId,
  passed: Boolean(signal),
  signal,
  reason,
  metrics
});

function resolveParams(strategyId, learnedParams, symbol) {
  const baseline = DEFAULT_PARAMS[strategyId];
  const exact = learnedParams?.[`${strategyId}|${symbol}`];
  const mainPrior = learnedParams?.__main_prior?.[strategyId];
  const usableExact =
    exact && Number(exact.sample_count) >= 10 ? exact : null;
  return {
    ...baseline,
    ...(mainPrior || {}),
    ...(usableExact || {}),
    sample_count: usableExact?.sample_count || 0,
    learned_from_scalp: Boolean(usableExact),
    main_prior_sample_count:
      mainPrior?.main_prior_sample_count || 0
  };
}

function buildSignal({
  direction,
  strategyId,
  strategyName,
  score,
  entry,
  atr,
  adx,
  rsi,
  volumeRatio,
  details
}) {
  return {
    direction,
    strategyId,
    strategyName,
    score: clamp(Math.round(score), 0, 100),
    entry: finite(entry, 0),
    indicators: {
      atr: finite(atr, 0),
      adx: finite(adx, 0),
      rsi: finite(rsi, 50),
      volumeRatio: finite(volumeRatio, 0)
    },
    details,
    tradeType: 'FUTURES'
  };
}

export function resolveMarketContext(marketContext) {
  if (!marketContext) {
    return {
      ready: false,
      reasons: ['MARKET_CONTEXT_MISSING'],
      microstructureReady: false,
      l1: null,
      l2: null,
      l3: null,
      obi: null,
      cvdTrend: null,
      bbwSlope: null,
      volRatio: null,
      isProvided: false
    };
  }

  return {
    ...marketContext,
    ready: marketContext.ready !== false,
    reasons: marketContext.reasons || [],
    microstructureReady:
      marketContext.microstructureReady !== false &&
      Number.isFinite(finite(marketContext.obi)),
    l1:
      marketContext.l1 ||
      marketContext.vectorDetails?.l1 ||
      null,
    l2:
      marketContext.l2 ||
      marketContext.vectorDetails?.l2 ||
      null,
    l3:
      marketContext.l3 ||
      marketContext.vectorDetails?.l3 ||
      null,
    obi: finite(marketContext.obi),
    cvdTrend: finite(marketContext.cvdTrend),
    bbwSlope: finite(marketContext.bbwSlope),
    volRatio: finite(marketContext.volRatio),
    isProvided: true
  };
}

export function getHTFTrend(htfCandles, period = 50) {
  if (!htfCandles || htfCandles.length < period) return 'NEUTRAL';
  const closes = htfCandles.map(candle => candle.close);
  const ema = calcEMA(closes, period);
  const lastClose = closes.at(-1);
  if (!Number.isFinite(ema) || !Number.isFinite(lastClose)) {
    return 'NEUTRAL';
  }
  return lastClose > ema ? 'UP' : lastClose < ema ? 'DOWN' : 'NEUTRAL';
}

function findRecentCross(emaFast, emaSlow, lookback) {
  const start = Math.max(1, emaFast.length - lookback);
  for (let index = emaFast.length - 1; index >= start; index -= 1) {
    const fast = emaFast[index];
    const slow = emaSlow[index];
    const previousFast = emaFast[index - 1];
    const previousSlow = emaSlow[index - 1];
    if (
      ![fast, slow, previousFast, previousSlow].every(Number.isFinite)
    ) {
      continue;
    }
    if (previousFast <= previousSlow && fast > slow) return 'LONG';
    if (previousFast >= previousSlow && fast < slow) return 'SHORT';
  }
  return null;
}

export function evaluateS1Decision(
  candles,
  volumes,
  params,
  htfCandles,
  marketContext
) {
  const strategyId = 'S1_EMA_MOMENTUM';
  const ctx = resolveMarketContext(marketContext);
  if (!candles || candles.length < 50) {
    return makeDecision(strategyId, { reason: 'INSUFFICIENT_CANDLES' });
  }
  if (!ctx.ready) {
    return makeDecision(strategyId, {
      reason: `DATA_NOT_READY:${ctx.reasons.join(',')}`
    });
  }
  if (!ctx.microstructureReady) {
    return makeDecision(strategyId, {
      reason: 'MICROSTRUCTURE_NOT_READY'
    });
  }
  if (!ctx.l1 || !ctx.l2) {
    return makeDecision(strategyId, { reason: 'REGIME_NOT_READY' });
  }
  if (
    (
      ctx.l1.includes('Range') ||
      ctx.l1.includes('Chop') ||
      ctx.l1.includes('Mean Reversion')
    ) &&
    ctx.l2 !== 'Expansion'
  ) {
    return makeDecision(strategyId, {
      reason: 'REGIME_NOT_MOMENTUM'
    });
  }

  const closes = candles.map(candle => candle.close);
  const ema9Array = calcEMAArray(closes, 9);
  const ema21Array = calcEMAArray(closes, 21);
  const cross = findRecentCross(
    ema9Array,
    ema21Array,
    Math.max(1, Math.round(params.crossover_lookback))
  );
  if (!cross) {
    return makeDecision(strategyId, { reason: 'NO_RECENT_EMA_CROSS' });
  }

  const entry = closes.at(-1);
  const ema9 = ema9Array.at(-1);
  const ema21 = ema21Array.at(-1);
  const volumeAverage = calcVolumeSMA(volumes, 20);
  const volumeRatio =
    volumeAverage > 0 ? volumes.at(-1) / volumeAverage : null;
  const adx = calcADX(candles, 14);
  const atr = calcATR(candles, 14);
  const rsi = calcRSI(closes, 7);
  const htfTrend = getHTFTrend(htfCandles, 50);
  const metrics = {
    cross,
    entry,
    ema9,
    ema21,
    volumeRatio,
    adx,
    atr,
    rsi,
    htfTrend,
    obi: ctx.obi,
    cvdTrend: ctx.cvdTrend
  };

  if (!Number.isFinite(volumeRatio) ||
      volumeRatio < params.volume_threshold) {
    return makeDecision(strategyId, {
      reason: 'VOLUME_CONFIRMATION_FAILED',
      metrics
    });
  }
  if (cross === 'LONG' && entry <= ema21) {
    return makeDecision(strategyId, {
      reason: 'LONG_BELOW_EMA21',
      metrics
    });
  }
  if (cross === 'SHORT' && entry >= ema21) {
    return makeDecision(strategyId, {
      reason: 'SHORT_ABOVE_EMA21',
      metrics
    });
  }
  if (
    (cross === 'LONG' && htfTrend === 'DOWN') ||
    (cross === 'SHORT' && htfTrend === 'UP')
  ) {
    return makeDecision(strategyId, {
      reason: 'HTF_COUNTER_TREND',
      metrics
    });
  }
  if (cross === 'LONG' && rsi > params.rsi_long_max) {
    return makeDecision(strategyId, {
      reason: 'LONG_RSI_EXHAUSTED',
      metrics
    });
  }
  if (cross === 'SHORT' && rsi < params.rsi_short_min) {
    return makeDecision(strategyId, {
      reason: 'SHORT_RSI_EXHAUSTED',
      metrics
    });
  }

  let score = 45;
  if (
    (cross === 'LONG' && htfTrend === 'UP') ||
    (cross === 'SHORT' && htfTrend === 'DOWN')
  ) score += 12;
  score += clamp((volumeRatio - params.volume_threshold) * 20, 0, 15);
  score += clamp((adx - 20) * 0.6, 0, 15);
  score += cross === 'LONG'
    ? clamp((ctx.obi - 0.5) * 40, -8, 8)
    : clamp((0.5 - ctx.obi) * 40, -8, 8);
  score += cross === 'LONG'
    ? clamp(ctx.cvdTrend * 0.5, -8, 8)
    : clamp(-ctx.cvdTrend * 0.5, -8, 8);

  if (score < params.min_score) {
    return makeDecision(strategyId, {
      reason: 'SOFT_SCORE_BELOW_THRESHOLD',
      metrics: { ...metrics, score, minimum: params.min_score }
    });
  }

  const signal = buildSignal({
    direction: cross,
    strategyId,
    strategyName: `EMA Momentum ${cross}`,
    score,
    entry,
    atr,
    adx,
    rsi,
    volumeRatio,
    details: {
      ...ctx,
      ema9,
      ema21,
      htfTrend,
      learned: params.learned_from_scalp,
      mainPriorSamples: params.main_prior_sample_count
    }
  });
  return makeDecision(strategyId, { signal, metrics });
}

function recentRsiValues(closes, lookback) {
  const values = [];
  for (
    let offset = Math.max(0, lookback - 1);
    offset >= 0;
    offset -= 1
  ) {
    const rsi = calcRSI(
      offset === 0 ? closes : closes.slice(0, -offset),
      7
    );
    if (Number.isFinite(rsi)) values.push(rsi);
  }
  return values;
}

export function evaluateS2Decision(
  candles,
  volumes,
  params,
  htfCandles,
  marketContext
) {
  const strategyId = 'S2_RSI_SNAP';
  const ctx = resolveMarketContext(marketContext);
  if (!candles || candles.length < 30) {
    return makeDecision(strategyId, { reason: 'INSUFFICIENT_CANDLES' });
  }
  if (!ctx.ready || !ctx.microstructureReady) {
    return makeDecision(strategyId, {
      reason: 'DATA_OR_MICROSTRUCTURE_NOT_READY'
    });
  }
  if (
    ctx.l1?.includes('Strong Trend') ||
    ctx.l2 === 'Expansion'
  ) {
    return makeDecision(strategyId, {
      reason: 'REGIME_NOT_MEAN_REVERSION'
    });
  }
  const allowedRegime =
    ctx.l1?.includes('Range') ||
    ctx.l1?.includes('Chop') ||
    ctx.l1?.includes('Mean Reversion') ||
    ctx.l2 === 'Extreme' ||
    ctx.l2 === 'Compression';
  if (!allowedRegime) {
    return makeDecision(strategyId, {
      reason: 'REGIME_NOT_MEAN_REVERSION'
    });
  }

  const closes = candles.map(candle => candle.close);
  const entry = closes.at(-1);
  const previousClose = closes.at(-2);
  const ema9 = calcEMA(closes, 9);
  const previousEma9 = calcEMA(closes.slice(0, -1), 9);
  const rsiValues = recentRsiValues(
    closes,
    Math.max(2, Math.round(params.reversal_lookback))
  );
  const rsi = rsiValues.at(-1);
  const minimumRecentRsi = Math.min(...rsiValues);
  const maximumRecentRsi = Math.max(...rsiValues);
  const longReclaim =
    minimumRecentRsi <= params.rsi_oversold &&
    previousClose <= previousEma9 &&
    entry > ema9;
  const shortReject =
    maximumRecentRsi >= params.rsi_overbought &&
    previousClose >= previousEma9 &&
    entry < ema9;
  const direction = longReclaim ? 'LONG' : shortReject ? 'SHORT' : null;
  const atr = calcATR(candles, 14);
  const adx = calcADX(candles, 14);
  const htfRsi = htfCandles?.length >= 15
    ? calcRSI(htfCandles.map(candle => candle.close), 14)
    : null;
  const volumeAverage = calcVolumeSMA(volumes, 20);
  const volumeRatio =
    volumeAverage > 0 ? volumes.at(-1) / volumeAverage : null;
  const metrics = {
    direction,
    entry,
    ema9,
    rsi,
    minimumRecentRsi,
    maximumRecentRsi,
    htfRsi,
    volumeRatio,
    obi: ctx.obi,
    cvdTrend: ctx.cvdTrend
  };
  if (!direction) {
    return makeDecision(strategyId, {
      reason: 'NO_RSI_RECLAIM_OR_REJECTION',
      metrics
    });
  }
  if (
    Number.isFinite(htfRsi) &&
    (
      (direction === 'LONG' && htfRsi < params.rsi_oversold) ||
      (direction === 'SHORT' && htfRsi > params.rsi_overbought)
    )
  ) {
    return makeDecision(strategyId, {
      reason: 'HTF_EXTREME_CONTINUATION_RISK',
      metrics
    });
  }

  const excursion = direction === 'LONG'
    ? params.rsi_oversold - minimumRecentRsi
    : maximumRecentRsi - params.rsi_overbought;
  let score = 48 + clamp(excursion * 1.5, 0, 20);
  score += direction === 'LONG'
    ? clamp((ctx.obi - 0.5) * 50, -10, 10)
    : clamp((0.5 - ctx.obi) * 50, -10, 10);
  score += direction === 'LONG'
    ? clamp(ctx.cvdTrend * 0.4, -8, 8)
    : clamp(-ctx.cvdTrend * 0.4, -8, 8);
  score += clamp((volumeRatio - 1) * 8, -5, 8);

  if (score < params.min_score) {
    return makeDecision(strategyId, {
      reason: 'SOFT_SCORE_BELOW_THRESHOLD',
      metrics: { ...metrics, score, minimum: params.min_score }
    });
  }

  const signal = buildSignal({
    direction,
    strategyId,
    strategyName: `RSI Snap ${direction}`,
    score,
    entry,
    atr,
    adx,
    rsi,
    volumeRatio,
    details: {
      ...ctx,
      htfRsi,
      learned: params.learned_from_scalp,
      mainPriorSamples: params.main_prior_sample_count
    }
  });
  return makeDecision(strategyId, { signal, metrics });
}

function priorBandWidthPercentile(closes, lookback) {
  const effectiveLookback = Math.min(
    lookback,
    closes.length - 20
  );
  if (effectiveLookback < 10) return null;
  const history = calcBBWidthHistory(
    closes,
    20,
    effectiveLookback
  );
  if (!history || history.length < 2) return null;
  const previousWidth = history.at(-1);
  return history.filter(width => width <= previousWidth).length /
    history.length;
}

export function evaluateS3Decision(
  candles,
  volumes,
  params,
  htfCandles,
  marketContext
) {
  const strategyId = 'S3_BB_SQUEEZE';
  const ctx = resolveMarketContext(marketContext);
  if (!candles || candles.length < 60) {
    return makeDecision(strategyId, { reason: 'INSUFFICIENT_CANDLES' });
  }
  if (!ctx.ready || !ctx.microstructureReady) {
    return makeDecision(strategyId, {
      reason: 'DATA_OR_MICROSTRUCTURE_NOT_READY'
    });
  }

  const closes = candles.map(candle => candle.close);
  const previousCloses = closes.slice(0, -1);
  const bands = calcBollingerBands(previousCloses, 20, 2);
  const squeezePercentile = priorBandWidthPercentile(
    previousCloses,
    40
  );
  const volumeAverage = calcVolumeSMA(volumes.slice(0, -1), 20);
  const volumeRatio =
    volumeAverage > 0 ? volumes.at(-1) / volumeAverage : null;
  const entry = closes.at(-1);
  const htfTrend = getHTFTrend(htfCandles, 50);
  const atr = calcATR(candles, 14);
  const adx = calcADX(candles, 14);
  const rsi = calcRSI(closes, 7);
  const direction =
    entry > bands?.upper ? 'LONG' :
      entry < bands?.lower ? 'SHORT' :
        null;
  const metrics = {
    direction,
    entry,
    previousUpper: bands?.upper,
    previousLower: bands?.lower,
    squeezePercentile,
    volumeRatio,
    bbwSlope: ctx.bbwSlope,
    htfTrend,
    obi: ctx.obi,
    cvdTrend: ctx.cvdTrend
  };

  if (
    !Number.isFinite(squeezePercentile) ||
    squeezePercentile > params.squeeze_percentile
  ) {
    return makeDecision(strategyId, {
      reason: 'NO_PRIOR_SQUEEZE',
      metrics
    });
  }
  if (
    !Number.isFinite(volumeRatio) ||
    volumeRatio < params.volume_threshold
  ) {
    return makeDecision(strategyId, {
      reason: 'NO_VOLUME_EXPANSION',
      metrics
    });
  }
  if (!direction) {
    return makeDecision(strategyId, {
      reason: 'NO_BAND_BREAKOUT',
      metrics
    });
  }
  if (
    ctx.l2 !== 'Expansion' &&
    ctx.bbwSlope < params.minimum_bbw_slope
  ) {
    return makeDecision(strategyId, {
      reason: 'BANDS_NOT_EXPANDING',
      metrics
    });
  }
  if (
    (direction === 'LONG' && htfTrend === 'DOWN') ||
    (direction === 'SHORT' && htfTrend === 'UP')
  ) {
    return makeDecision(strategyId, {
      reason: 'HTF_COUNTER_TREND',
      metrics
    });
  }

  let score = 50;
  score += clamp(
    (params.squeeze_percentile - squeezePercentile) * 40,
    0,
    10
  );
  score += clamp(
    (volumeRatio - params.volume_threshold) * 20,
    0,
    15
  );
  score += clamp(ctx.bbwSlope * 0.5, 0, 10);
  score += direction === 'LONG'
    ? clamp((ctx.obi - 0.5) * 40, -8, 8)
    : clamp((0.5 - ctx.obi) * 40, -8, 8);
  score += direction === 'LONG'
    ? clamp(ctx.cvdTrend * 0.4, -8, 8)
    : clamp(-ctx.cvdTrend * 0.4, -8, 8);

  if (score < params.min_score) {
    return makeDecision(strategyId, {
      reason: 'SOFT_SCORE_BELOW_THRESHOLD',
      metrics: { ...metrics, score, minimum: params.min_score }
    });
  }

  const signal = buildSignal({
    direction,
    strategyId,
    strategyName: `BB Squeeze Breakout ${direction}`,
    score,
    entry,
    atr,
    adx,
    rsi,
    volumeRatio,
    details: {
      ...ctx,
      squeezePercentile,
      htfTrend,
      learned: params.learned_from_scalp,
      mainPriorSamples: params.main_prior_sample_count
    }
  });
  return makeDecision(strategyId, { signal, metrics });
}

export function evaluateScalpSignalsWithDiagnostics(
  candles,
  volumes,
  learnedParams = {},
  htfCandles = null,
  marketContext = null,
  symbol = ''
) {
  const evaluators = {
    S1_EMA_MOMENTUM: evaluateS1Decision,
    S2_RSI_SNAP: evaluateS2Decision,
    S3_BB_SQUEEZE: evaluateS3Decision
  };
  const decisions = Object.entries(evaluators).map(
    ([strategyId, evaluator]) =>
      evaluator(
        candles,
        volumes,
        resolveParams(strategyId, learnedParams, symbol),
        htfCandles,
        marketContext
      )
  );
  const signals = decisions
    .map(decision => decision.signal)
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  return { signals, decisions };
}

export function evaluateScalpSignals(
  candles,
  volumes,
  learnedParams = {},
  htfCandles = null,
  marketContext = null,
  symbol = ''
) {
  return evaluateScalpSignalsWithDiagnostics(
    candles,
    volumes,
    learnedParams,
    htfCandles,
    marketContext,
    symbol
  ).signals;
}

export function evaluateS1_EMAMomentum(
  candles,
  volumes,
  params = null,
  htfCandles = null,
  marketContext = null
) {
  return evaluateS1Decision(
    candles,
    volumes,
    { ...DEFAULT_PARAMS.S1_EMA_MOMENTUM, ...(params || {}) },
    htfCandles,
    marketContext
  ).signal;
}

export function evaluateS2_RSISnap(
  candles,
  volumes,
  params = null,
  htfCandles = null,
  marketContext = null
) {
  return evaluateS2Decision(
    candles,
    volumes,
    { ...DEFAULT_PARAMS.S2_RSI_SNAP, ...(params || {}) },
    htfCandles,
    marketContext
  ).signal;
}

export function evaluateS3_BBSqueeze(
  candles,
  volumes,
  params = null,
  htfCandles = null,
  marketContext = null
) {
  return evaluateS3Decision(
    candles,
    volumes,
    { ...DEFAULT_PARAMS.S3_BB_SQUEEZE, ...(params || {}) },
    htfCandles,
    marketContext
  ).signal;
}

export function evaluateSingleStrategy(
  candles,
  volumes,
  strategyId,
  params,
  htfCandles = null,
  marketContext = null
) {
  const evaluators = {
    S1_EMA_MOMENTUM: evaluateS1Decision,
    S2_RSI_SNAP: evaluateS2Decision,
    S3_BB_SQUEEZE: evaluateS3Decision
  };
  const evaluator = evaluators[strategyId];
  if (!evaluator) return [];
  const decision = evaluator(
    candles,
    volumes,
    { ...DEFAULT_PARAMS[strategyId], ...(params || {}) },
    htfCandles,
    marketContext
  );
  return decision.signal ? [decision.signal] : [];
}

export { DEFAULT_PARAMS };

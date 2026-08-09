import QuantMath from '../../../../src/domain/analytics/QuantMath.js';
import {
  evaluateL1,
  evaluateL2,
  evaluateL3
} from '../../../../src/domain/analytics/quant/regime.js';
import {
  calcADX,
  calcATR,
  calcBollingerBands,
  calcEMA
} from './scalpIndicators.js';

const MIN_CONTEXT_CANDLES = 220;
const RANK_LOOKBACK = 100;
const CVD_LOOKBACK = 50;

const finite = value => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const average = values =>
  values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

const percentileRank = (current, history) => {
  const valid = history.filter(Number.isFinite);
  if (!Number.isFinite(current) || valid.length === 0) return null;
  return valid.filter(value => value < current).length / valid.length * 100;
};

const percentChange = (current, previous) =>
  Number.isFinite(current) &&
  Number.isFinite(previous) &&
  previous !== 0
    ? (current / previous - 1) * 100
    : 0;

export function normalizeRestKline(kline, now = Date.now()) {
  const closeTime = finite(kline?.[6]);
  return {
    openTime: finite(kline?.[0]),
    open: finite(kline?.[1]),
    high: finite(kline?.[2]),
    low: finite(kline?.[3]),
    close: finite(kline?.[4]),
    volume: finite(kline?.[5]),
    closeTime,
    quoteVolume: finite(kline?.[7]),
    tradeCount: finite(kline?.[8]),
    takerBuyVolume: finite(kline?.[9]),
    takerBuyQuoteVolume: finite(kline?.[10]),
    isClosed: Number.isFinite(closeTime) && closeTime <= now
  };
}

export function normalizeStreamKline(message) {
  const kline = message?.k;
  if (!kline) return null;
  return {
    openTime: finite(kline.t),
    open: finite(kline.o),
    high: finite(kline.h),
    low: finite(kline.l),
    close: finite(kline.c),
    volume: finite(kline.v),
    closeTime: finite(kline.T),
    quoteVolume: finite(kline.q),
    tradeCount: finite(kline.n),
    takerBuyVolume: finite(kline.V),
    takerBuyQuoteVolume: finite(kline.Q),
    isClosed: kline.x === true
  };
}

export function mergeCandle(candles, candle, maxLength = 320) {
  if (
    !Array.isArray(candles) ||
    !candle ||
    !Number.isFinite(candle.openTime)
  ) {
    return candles;
  }

  const existingIndex = candles.findIndex(
    item => item.openTime === candle.openTime
  );
  if (existingIndex >= 0) candles[existingIndex] = candle;
  else candles.push(candle);

  candles.sort((left, right) => left.openTime - right.openTime);
  if (candles.length > maxLength) {
    candles.splice(0, candles.length - maxLength);
  }
  return candles;
}

export function calculateOrderBookImbalance(bids, asks) {
  const bidNotional = (bids || []).reduce((sum, level) => {
    const price = finite(level?.[0]);
    const quantity = finite(level?.[1]);
    return sum + (
      Number.isFinite(price) && Number.isFinite(quantity)
        ? price * quantity
        : 0
    );
  }, 0);
  const askNotional = (asks || []).reduce((sum, level) => {
    const price = finite(level?.[0]);
    const quantity = finite(level?.[1]);
    return sum + (
      Number.isFinite(price) && Number.isFinite(quantity)
        ? price * quantity
        : 0
    );
  }, 0);
  const total = bidNotional + askNotional;
  if (total <= 0) return null;
  return bidNotional / total;
}

function buildVolatilityHistory(candles) {
  const atrPercentHistory = [];
  const bbwHistory = [];
  const start = Math.max(30, candles.length - RANK_LOOKBACK - 4);

  for (let end = start; end < candles.length; end += 1) {
    const slice = candles.slice(0, end + 1);
    const close = slice.at(-1)?.close;
    const atr = calcATR(slice, 14);
    const bands = calcBollingerBands(
      slice.map(candle => candle.close),
      20,
      2
    );
    if (Number.isFinite(atr) && close > 0) {
      atrPercentHistory.push(atr / close * 100);
    }
    if (Number.isFinite(bands?.widthPct)) {
      bbwHistory.push(bands.widthPct);
    }
  }
  return { atrPercentHistory, bbwHistory };
}

export function buildScalpMarketContext({
  candles,
  depthSnapshot,
  intervalMs,
  now = Date.now()
}) {
  const closedCandles = (candles || []).filter(
    candle =>
      candle?.isClosed !== false &&
      Number.isFinite(candle?.close) &&
      Number.isFinite(candle?.high) &&
      Number.isFinite(candle?.low) &&
      Number.isFinite(candle?.volume) &&
      Number.isFinite(candle?.takerBuyVolume)
  );
  const reasons = [];

  if (closedCandles.length < MIN_CONTEXT_CANDLES) {
    reasons.push(
      `CANDLE_HISTORY_${closedCandles.length}_LT_${MIN_CONTEXT_CANDLES}`
    );
  }

  const lastCandle = closedCandles.at(-1);
  const candleFresh =
    Number.isFinite(lastCandle?.closeTime) &&
    Number.isFinite(intervalMs) &&
    now - lastCandle.closeTime <= intervalMs * 2;
  if (!candleFresh) reasons.push('CANDLE_STREAM_STALE');

  const depthAgeMs =
    Number.isFinite(depthSnapshot?.receivedAt)
      ? now - depthSnapshot.receivedAt
      : Number.POSITIVE_INFINITY;
  const obi = calculateOrderBookImbalance(
    depthSnapshot?.bids,
    depthSnapshot?.asks
  );
  const microstructureReady =
    Number.isFinite(obi) &&
    depthAgeMs >= 0 &&
    depthAgeMs <= 5_000;
  if (!microstructureReady) reasons.push('ORDER_BOOK_STALE_OR_MISSING');

  if (reasons.some(reason => reason.startsWith('CANDLE_'))) {
    return {
      ready: false,
      reasons,
      microstructureReady,
      obi,
      depthAgeMs
    };
  }

  const working = closedCandles.slice(-Math.max(
    MIN_CONTEXT_CANDLES,
    RANK_LOOKBACK + 40
  ));
  const closes = working.map(candle => candle.close);
  const volumes = working.map(candle => candle.volume);
  const takerBuyVolumes = working.map(
    candle => candle.takerBuyVolume
  );
  const currentPrice = closes.at(-1);
  const atr14 = calcATR(working, 14);
  const adx = calcADX(working, 14);
  const bands = calcBollingerBands(closes, 20, 2);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const previousEma20 = calcEMA(closes.slice(0, -1), 20);
  const previousEma50 = calcEMA(closes.slice(0, -1), 50);
  const previousEma200 = calcEMA(closes.slice(0, -1), 200);
  const atrPercent = atr14 / currentPrice * 100;
  const { atrPercentHistory, bbwHistory } =
    buildVolatilityHistory(working);
  const historicalAtr = atrPercentHistory.slice(0, -1);
  const historicalBbw = bbwHistory.slice(0, -1);
  const atrRank = percentileRank(atrPercent, historicalAtr);
  const bbwRank = percentileRank(bands.widthPct, historicalBbw);
  const previousBbw = bbwHistory.at(-4);
  const bbwSlope = percentChange(bands.widthPct, previousBbw);
  const avgVolume20 = average(volumes.slice(-20));
  const volRatio =
    avgVolume20 > 0 ? volumes.at(-1) / avgVolume20 : null;

  const recentVolumes = volumes.slice(-CVD_LOOKBACK);
  const recentTakerBuy = takerBuyVolumes.slice(-CVD_LOOKBACK);
  const totalVolume = recentVolumes.reduce(
    (sum, value) => sum + value,
    0
  );
  const takerBuyVolume = recentTakerBuy.reduce(
    (sum, value) => sum + value,
    0
  );
  const takerSellVolume = totalVolume - takerBuyVolume;
  const takerRatio =
    takerSellVolume > 0 ? takerBuyVolume / takerSellVolume : null;
  const cumulativeDelta = recentVolumes.reduce(
    (sum, volume, index) =>
      sum + (
        recentTakerBuy[index] -
        (volume - recentTakerBuy[index])
      ),
    0
  );
  const cvdTrend =
    totalVolume > 0 ? cumulativeDelta / totalVolume * 100 : null;
  const vwap = QuantMath.vwapWithBands(
    working.map(candle => candle.high),
    working.map(candle => candle.low),
    closes,
    volumes,
    Math.min(100, working.length)
  );
  const autoData = {
    currentPrice,
    ema20: {
      value: ema20,
      slope: percentChange(ema20, previousEma20)
    },
    ema50: {
      value: ema50,
      slope: percentChange(ema50, previousEma50)
    },
    ema200: {
      value: ema200,
      slope: percentChange(ema200, previousEma200)
    },
    htfSma200: ema200,
    atrPercent,
    macd: QuantMath.macd(closes, 12, 26, 9),
    adx,
    hurstValue: QuantMath.hurst(
      closes,
      Math.min(100, closes.length)
    ),
    cvdTrend,
    takerRatio,
    atrRank,
    bbwRank,
    bbwSlope,
    lastClosedVolume: volumes.at(-1),
    avgVolume20,
    obi,
    vpinValue: null,
    fundingSlope: null
  };
  const l1Result = evaluateL1(autoData);
  const l2Result = evaluateL2(autoData);
  const l3Result = evaluateL3(
    autoData,
    l1Result.l1,
    l2Result.l2
  );

  return {
    ready: reasons.length === 0,
    reasons,
    microstructureReady,
    currentPrice,
    atr14,
    adx,
    atrRank,
    bbw: bands.widthPct,
    bbwRank,
    bbwSlope,
    volRatio,
    obi,
    depthAgeMs,
    cvdTrend,
    takerRatio,
    vwap: vwap?.vwap ?? null,
    vwapUpper: vwap?.upper2 ?? null,
    vwapLower: vwap?.lower2 ?? null,
    hurstValue: autoData.hurstValue,
    l1: l1Result.l1,
    l2: l2Result.l2,
    l3: l3Result.l3,
    vectorDetails: {
      l1: l1Result.l1,
      l2: l2Result.l2,
      l3: l3Result.l3
    }
  };
}

export {
  CVD_LOOKBACK,
  MIN_CONTEXT_CANDLES,
  RANK_LOOKBACK
};

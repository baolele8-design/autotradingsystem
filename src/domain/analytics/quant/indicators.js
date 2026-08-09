import { ema, emaSeries } from './statistics.js';

export const macd = (closes, fast = 12, slow = 26, sig = 9) => {
  if (!closes || closes.length < slow + sig) return {
    macd: 0,
    signal: 0,
    hist: 0
  };
  const fastEmaSeries = emaSeries(closes, fast);
  const slowEmaSeries = emaSeries(closes, slow);
  const diff = fastEmaSeries.length - slowEmaSeries.length;
  let macdSeries = [];
  for (let i = 0; i < slowEmaSeries.length; i++) {
    macdSeries.push(fastEmaSeries[i + diff] - slowEmaSeries[i]);
  }
  const signalLine = ema(macdSeries, sig);
  const currentMacd = macdSeries[macdSeries.length - 1];
  return {
    macd: currentMacd,
    signal: signalLine,
    hist: currentMacd - signalLine
  };
};

export const vwapWithBands = (highs, lows, closes, volumes, period = 200) => {
  if (!closes || closes.length < period) return {
    vwap: closes[closes.length - 1],
    upper1: 0,
    lower1: 0,
    upper2: 0,
    lower2: 0
  };
  const sliceH = highs.slice(-period);
  const sliceL = lows.slice(-period);
  const sliceC = closes.slice(-period);
  const sliceV = volumes.slice(-period);
  let sumVol = 0;
  let sumPriceVol = 0;
  for (let i = 0; i < period; i++) {
    const typicalPrice = (sliceH[i] + sliceL[i] + sliceC[i]) / 3;
    sumPriceVol += typicalPrice * sliceV[i];
    sumVol += sliceV[i];
  }
  const vwap = sumVol > 0 ? sumPriceVol / sumVol : sliceC[sliceC.length - 1];

  // Tính Phương sai (Variance) để làm Dải Band
  let varianceSum = 0;
  for (let i = 0; i < period; i++) {
    const typicalPrice = (sliceH[i] + sliceL[i] + sliceC[i]) / 3;
    varianceSum += sliceV[i] * Math.pow(typicalPrice - vwap, 2);
  }
  const sd = Math.sqrt(varianceSum / (sumVol || 1));
  return {
    vwap,
    upper1: vwap + sd,
    lower1: vwap - sd,
    upper2: vwap + sd * 2,
    lower2: vwap - sd * 2
  };
};

export const cvd = (volumes, buyVolumes, period = 50) => {
  if (!volumes || !buyVolumes || volumes.length < period) return {
    currentCVD: 0,
    cvdTrend: 0
  };
  let cumulativeDelta = 0;
  let totalVolumePeriod = 0;
  const startIdx = volumes.length - period;
  for (let i = startIdx; i < volumes.length; i++) {
    const sellVol = volumes[i] - buyVolumes[i];
    const delta = buyVolumes[i] - sellVol;
    cumulativeDelta += delta;
    totalVolumePeriod += volumes[i];
  }

  // ✅ BẢN VÁ CHUẨN QUANT: Net Taker Flow % (So với tổng thanh khoản)
  const cvdTrend = totalVolumePeriod > 0 ? cumulativeDelta / totalVolumePeriod * 100 : 0;
  return {
    currentCVD: cumulativeDelta,
    cvdTrend
  };
};

export const hurst = (closes, period = 100) => {
  if (!closes || closes.length < period) return 0.5;
  const slice = closes.slice(-period);
  let logReturns = [];
  for (let i = 1; i < slice.length; i++) logReturns.push(Math.log(slice[i] / slice[i - 1]));
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  let sumDev = 0;
  let minCum = 0;
  let maxCum = 0;

  // Rescaled Range (R/S) Calculation
  for (let i = 0; i < logReturns.length; i++) {
    sumDev += logReturns[i] - mean;
    if (sumDev > maxCum) maxCum = sumDev;
    if (sumDev < minCum) minCum = sumDev;
  }
  const range = maxCum - minCum;
  const stdDev = Math.sqrt(logReturns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / logReturns.length);
  const rs = stdDev === 0 ? 0 : range / stdDev;
  // Công thức xấp xỉ logarit của H
  const h = Math.log(rs) / Math.log(period);
  return Math.max(0.1, Math.min(0.9, h)); // Chuẩn hóa vào phổ 0.1 - 0.9
};

export const orderBookHeatmap = (bids, asks, currentPrice, depthPercent = 0.01) => {
  let bidVol = 0;
  let askVol = 0;
  const minBidPrice = currentPrice * (1 - depthPercent);
  const maxAskPrice = currentPrice * (1 + depthPercent);
  bids.forEach(b => {
    if (parseFloat(b[0]) >= minBidPrice) bidVol += parseFloat(b[1]);
  });
  asks.forEach(a => {
    if (parseFloat(a[0]) <= maxAskPrice) askVol += parseFloat(a[1]);
  });
  const totalBook = bidVol + askVol;
  return totalBook > 0 ? bidVol / totalBook : 0.5; // OBI Heatmap: >0.6 là tường mua dày, <0.4 là tường bán đè
};

export const trueRange = (h, l, pc) => Math.max(h - l || 0, Math.abs(h - pc) || 0, Math.abs(l - pc) || 0);

export const atr = (highs, lows, closes, period) => {
  if (!closes || closes.length < period + 1 || highs.length !== closes.length) return 0;
  let trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(trueRange(highs[i], lows[i], closes[i - 1]));
  }
  let currentAtr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    currentAtr = (currentAtr * (period - 1) + trs[i]) / period;
  }
  return currentAtr || 0;
};

export const adx = (highs, lows, closes, period = 14) => {
  if (!closes || closes.length < period * 2) return 0;
  let trs = [],
    plusDMs = [],
    minusDMs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(trueRange(highs[i], lows[i], closes[i - 1]));
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  let smoothedTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let dxs = [];
  for (let i = period; i < trs.length; i++) {
    smoothedTR = smoothedTR - smoothedTR / period + trs[i];
    smoothedPlusDM = smoothedPlusDM - smoothedPlusDM / period + plusDMs[i];
    smoothedMinusDM = smoothedMinusDM - smoothedMinusDM / period + minusDMs[i];
    const plusDI = 100 * (smoothedPlusDM / smoothedTR);
    const minusDI = 100 * (smoothedMinusDM / smoothedTR);
    const dx = 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1);
    dxs.push(dx || 0);
  }
  let adx = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxs.length; i++) {
    adx = (adx * (period - 1) + dxs[i]) / period;
  }
  return adx || 0;
};

export const rsi = (closes, period = 14) => {
  if (!closes || closes.length < period + 1) return 50;
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

export const bollinger = (closes, period = 20, stdDev = 2) => {
  if (!closes || closes.length < period) return {
    bbw: 0,
    upper: 0,
    lower: 0,
    sma: 0
  };
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const dev = Math.sqrt(variance);
  const upper = sma + stdDev * dev;
  const lower = sma - stdDev * dev;
  const bbw = (upper - lower) / sma * 100;
  return {
    bbw,
    upper,
    lower,
    sma
  };
};

export const obv = (closes, volumes) => {
  if (!closes || closes.length < 2) return 0;
  let obv = 0;
  for (let j = 1; j < closes.length; j++) {
    if (closes[j] > closes[j - 1]) obv += volumes[j];else if (closes[j] < closes[j - 1]) obv -= volumes[j];
  }
  return obv;
};

export const cmf = (highs, lows, closes, volumes, period = 20) => {
  if (!closes || closes.length < period) return 0;
  let mfValues = [];
  for (let j = 0; j < closes.length; j++) {
    const clv = (closes[j] - lows[j] - (highs[j] - closes[j])) / (highs[j] - lows[j] || 1);
    mfValues.push(clv * volumes[j]);
  }
  const recentMfSum = mfValues.slice(-period).reduce((a, b) => a + b, 0);
  const recentVolSum = volumes.slice(-period).reduce((a, b) => a + b, 0);
  return recentMfSum / (recentVolSum || 1);
};

export const scanEmaRange = (closesArray, fastPeriod, slowPeriod, lookback = 20, atrValue = 0) => {
  if (!closesArray || closesArray.length < Math.max(fastPeriod, slowPeriod) + lookback) {
    return {
      fastEmaCurrent: 0,
      slowEmaCurrent: 0,
      fastSlope: 0,
      slowSlope: 0,
      isCrossBull: false,
      isCrossBear: false,
      spreadPercent: 0,
      normFastSlope: 0,
      normSlowSlope: 0
    };
  }
  const fastEmaCurrent = ema(closesArray, fastPeriod);
  const slowEmaCurrent = ema(closesArray, slowPeriod);
  const pastCloses = closesArray.slice(0, -lookback);
  const fastEmaPast = ema(pastCloses, fastPeriod);
  const slowEmaPast = ema(pastCloses, slowPeriod);
  const fastSlope = fastEmaPast > 0 ? (fastEmaCurrent - fastEmaPast) / fastEmaPast * 100 : 0;
  const slowSlope = slowEmaPast > 0 ? (slowEmaCurrent - slowEmaPast) / slowEmaPast * 100 : 0;
  const normFastSlope = atrValue > 0 && fastEmaPast > 0 ? (fastEmaCurrent - fastEmaPast) / atrValue : fastSlope;
  const normSlowSlope = atrValue > 0 && slowEmaPast > 0 ? (slowEmaCurrent - slowEmaPast) / atrValue : slowSlope;
  const isCrossBull = fastEmaPast < slowEmaPast && fastEmaCurrent > slowEmaCurrent;
  const isCrossBear = fastEmaPast > slowEmaPast && fastEmaCurrent < slowEmaCurrent;
  const spreadPercent = slowEmaCurrent > 0 ? Math.abs(fastEmaCurrent - slowEmaCurrent) / slowEmaCurrent * 100 : 0;
  return {
    fastEmaCurrent,
    slowEmaCurrent,
    fastSlope,
    slowSlope,
    isCrossBull,
    isCrossBear,
    spreadPercent,
    normFastSlope,
    normSlowSlope
  };
};

export const detectSFP_Advanced = (highs, lows, closes, volumes, avgVolume, direction) => {
  if (!closes || closes.length < 10 || !volumes) return false;
  const triggerIndex = closes.length - 2;
  const triggerClose = closes[triggerIndex];
  const triggerHigh = highs[triggerIndex];
  const triggerLow = lows[triggerIndex];
  const triggerVol = volumes[triggerIndex];
  if (triggerVol < avgVolume * 1.2) return false;
  let lastPivotHigh = -1;
  let lastPivotLow = Infinity;
  for (let j = triggerIndex - 3; j >= 2; j--) {
    if (highs[j] > highs[j - 1] && highs[j] > highs[j - 2] && highs[j] > highs[j + 1] && highs[j] > highs[j + 2]) {
      lastPivotHigh = highs[j];
      break;
    }
  }
  for (let j = triggerIndex - 3; j >= 2; j--) {
    if (lows[j] < lows[j - 1] && lows[j] < lows[j - 2] && lows[j] < lows[j + 1] && lows[j] < lows[j + 2]) {
      lastPivotLow = lows[j];
      break;
    }
  }
  if (direction === 'SHORT') {
    return lastPivotHigh !== -1 && triggerHigh > lastPivotHigh && triggerClose < lastPivotHigh;
  } else {
    return lastPivotLow !== Infinity && triggerLow < lastPivotLow && triggerClose > lastPivotLow;
  }
};

export const detectSFP_Institutional_Advanced = (highs, lows, closes, opens, volumes, avgVolume, atrValue, direction, lookback = 20) => {
  if (!closes || closes.length < lookback || !volumes) return false;
  const i = closes.length - 2;
  if (i < lookback) return false;
  const currentHigh = highs[i];
  const currentLow = lows[i];
  const currentClose = closes[i];
  const currentOpen = opens[i];
  const currentVol = volumes[i];
  if (currentVol < avgVolume * 1.2) return false;
  const lookbackHighs = highs.slice(i - lookback, i);
  const lookbackLows = lows.slice(i - lookback, i);
  const pivotHigh = Math.max(...lookbackHighs);
  const pivotLow = Math.min(...lookbackLows);
  const candleLength = currentHigh - currentLow;
  if (candleLength < atrValue * 0.5) return false;
  const upperWick = currentHigh - Math.max(currentOpen, currentClose);
  const lowerWick = Math.min(currentOpen, currentClose) - currentLow;
  if (direction === 'SHORT') {
    const isWickSignificant = upperWick / candleLength >= 0.5;
    const isSweepingPivot = currentHigh > pivotHigh;
    const isClosingBelow = currentClose < pivotHigh;
    return isWickSignificant && isSweepingPivot && isClosingBelow;
  } else {
    const isWickSignificant = lowerWick / candleLength >= 0.5;
    const isSweepingPivot = currentLow < pivotLow;
    const isClosingAbove = currentClose > pivotLow;
    return isWickSignificant && isSweepingPivot && isClosingAbove;
  }
};

export const detectMarketStructure = (highs, lows, closes, lookback = 20) => {
  let swingHighs = [];
  let swingLows = [];

  // 1. Tìm các Swing Points (Đỉnh/Đáy cục bộ)
  for (let i = 2; i < closes.length - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
      swingHighs.push({
        index: i,
        price: highs[i]
      });
    }
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
      swingLows.push({
        index: i,
        price: lows[i]
      });
    }
  }

  // Sửa tại file src/core/QuantMath.js
  if (swingHighs.length < 2 || swingLows.length < 2) {
    return {
      regime: 'Sideways',
      msbState: 'None',
      sfp: false
    }; // Đổi 'msb' thành 'msbState'
  }
  const lastSH = swingHighs[swingHighs.length - 1];
  const prevSH = swingHighs[swingHighs.length - 2];
  const lastSL = swingLows[swingLows.length - 1];
  const prevSL = swingLows[swingLows.length - 2];
  const currentClose = closes[closes.length - 1];
  const currentHigh = highs[highs.length - 1];
  const currentLow = lows[lows.length - 1];
  let msbState = 'None';
  let isSFP = false;

  // 2. Phát hiện MSB Tăng (Bullish MSB / ChoCH)
  if (currentHigh > lastSH.price) {
    if (currentClose > lastSH.price) {
      msbState = 'Bullish_MSB'; // Phá vỡ cấu trúc giảm hợp lệ
    } else {
      isSFP = 'Bearish_SFP'; // Bẫy thanh khoản (Chỉ quét râu)
    }
  }

  // 3. Phát hiện MSB Giảm (Bearish MSB / ChoCH)
  if (currentLow < lastSL.price) {
    if (currentClose < lastSL.price) {
      msbState = 'Bearish_MSB'; // Phá vỡ cấu trúc tăng hợp lệ
    } else {
      isSFP = 'Bullish_SFP'; // Bẫy thanh khoản (Chỉ quét râu)
    }
  }

  // 4. Xác định Regime (HH/HL hay LH/LL)
  let regime = 'Range';
  if (lastSH.price > prevSH.price && lastSL.price > prevSL.price) regime = 'Uptrend';
  if (lastSH.price < prevSH.price && lastSL.price < prevSL.price) regime = 'Downtrend';
  return {
    regime,
    msbState,
    isSFP,
    lastSH,
    lastSL
  };
};

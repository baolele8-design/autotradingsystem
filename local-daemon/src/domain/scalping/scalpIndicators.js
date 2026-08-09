const sum = (arr) => {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
};

export const calcEMA = (data, period) => {
  if (!data || data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = sum(data.slice(0, period)) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
};

export const calcEMAArray = (data, period) => {
  if (!data || data.length < 2) return [];
  const k = 2 / (period + 1);
  const result = new Array(data.length).fill(null);
  result[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    const prev = result[i - 1];
    if (prev === null) {
      if (i + 1 >= period) {
        result[i] = sum(data.slice(0, period)) / period;
      }
    } else {
      result[i] = data[i] * k + prev * (1 - k);
    }
  }
  return result;
};

export const calcRSI = (closes, period = 7) => {
  if (!closes || closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
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

export const calcATR = (candles, period = 14) => {
  if (!candles || candles.length < period + 1) return null;

  let trSum = 0;
  for (let i = 1; i <= period; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trSum += tr;
  }

  let atr = trSum / period;

  for (let i = period + 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    atr = (atr * (period - 1) + tr) / period;
  }

  return atr;
};

export const calcSMA = (data, period) => {
  if (!data || data.length < period) return null;
  return sum(data.slice(data.length - period)) / period;
};

export const calcADX = (candles, period = 14) => {
  if (!candles || candles.length < period + 1) return null;

  const trValues = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    trValues.push(
      Math.max(high - low, Math.abs(high - prevHigh), Math.abs(low - prevLow))
    );

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }

  let atrVal = sum(trValues.slice(0, period)) / period;
  let smoothedPlusDM = sum(plusDM.slice(0, period)) / period;
  let smoothedMinusDM = sum(minusDM.slice(0, period)) / period;

  const dxValues = [];
  for (let i = period; i < trValues.length; i++) {
    atrVal = (atrVal * (period - 1) + trValues[i]) / period;
    smoothedPlusDM = (smoothedPlusDM * (period - 1) + plusDM[i]) / period;
    smoothedMinusDM = (smoothedMinusDM * (period - 1) + minusDM[i]) / period;

    const diPlus = atrVal > 0 ? (smoothedPlusDM / atrVal) * 100 : 0;
    const diMinus = atrVal > 0 ? (smoothedMinusDM / atrVal) * 100 : 0;
    const dx = (diPlus + diMinus) > 0
      ? (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100
      : 0;
    dxValues.push(dx);
  }

  if (dxValues.length === 0) return null;
  return sum(dxValues) / dxValues.length;
};

export const calcBollingerBands = (closes, period = 20, multiplier = 2) => {
  if (!closes || closes.length < period) return null;

  const slice = closes.slice(closes.length - period);
  const sma = sum(slice) / period;

  let variance = 0;
  for (let i = 0; i < slice.length; i++) {
    variance += (slice[i] - sma) ** 2;
  }
  const std = Math.sqrt(variance / period);

  return {
    middle: sma,
    upper: sma + multiplier * std,
    lower: sma - multiplier * std,
    width: (2 * multiplier * std) / sma,
    widthPct: ((2 * multiplier * std) / sma) * 100
  };
};

export const calcBBWidthHistory = (closes, period = 20, lookback = 20) => {
  if (!closes || closes.length < period + lookback) return null;

  const widths = [];
  for (let i = 0; i < lookback; i++) {
    const slice = closes.slice(
      closes.length - period - lookback + i,
      closes.length - lookback + i
    );
    if (slice.length < period) continue;

    const sma = sum(slice) / period;
    let variance = 0;
    for (let j = 0; j < slice.length; j++) {
      variance += (slice[j] - sma) ** 2;
    }
    const std = Math.sqrt(variance / period);
    widths.push((4 * std) / sma);
  }

  return widths;
};

export const calcVolumeSMA = (volumes, period = 20) => {
  return calcSMA(volumes, period);
};

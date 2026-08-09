export const sma = (data, period) => {
  if (!data || data.length === 0 || period <= 0) return 0;
  // BẢN VÁ: Nếu không đủ nến, tính trung bình trên số nến hiện có
  const actualPeriod = Math.min(data.length, period);
  return data.slice(-actualPeriod).reduce((a, b) => a + b, 0) / actualPeriod;
};

export const ema = (data, period) => {
  if (!data || data.length < period || period <= 0) return 0;
  const k = 2 / (period + 1);
  let emaVal = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    emaVal = data[i] * k + emaVal * (1 - k);
  }
  return emaVal;
};

export const emaSeries = (data, period) => {
  let emaArr = [];
  if (!data || data.length < period) return emaArr;
  const k = 2 / (period + 1);
  let emaVal = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period - 1; i < data.length; i++) {
    if (i === period - 1) emaArr.push(emaVal);else {
      emaVal = data[i] * k + emaVal * (1 - k);
      emaArr.push(emaVal);
    }
  }
  return emaArr;
};

export const percentileRank = (currentValue, historicalArray) => {
  if (!historicalArray || historicalArray.length === 0) return 50;
  const belowCount = historicalArray.filter(val => val < currentValue).length;
  return belowCount / historicalArray.length * 100;
};

export const pearsonCorrelation = (x, y) => {
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0;
  const minLength = Math.min(x.length, y.length);
  if (minLength < 2) return 0;
  for (let i = 0; i < minLength; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }
  const num = minLength * sumXY - sumX * sumY;
  const den = Math.sqrt((minLength * sumX2 - sumX * sumX) * (minLength * sumY2 - sumY * sumY));
  return den === 0 ? 0 : num / den;
};

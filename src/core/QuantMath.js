// FILE: src/core/QuantMath.js

const QuantMath = {
  sma: (data, period) => {
    if (!data || data.length < period || period <= 0) return 0;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  },
  
  ema: (data, period) => {
    if (!data || data.length < period || period <= 0) return 0;
    const k = 2 / (period + 1);
    let emaVal = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      emaVal = (data[i] * k) + (emaVal * (1 - k));
    }
    return emaVal;
  },
  
  trueRange: (h, l, pc) => Math.max(h - l || 0, Math.abs(h - pc) || 0, Math.abs(l - pc) || 0),
  
  atr: (highs, lows, closes, period) => {
    if (!closes || closes.length < period + 1 || highs.length !== closes.length) return 0;
    let trs = [];
    for (let i = 1; i < closes.length; i++) {
      trs.push(QuantMath.trueRange(highs[i], lows[i], closes[i-1]));
    }
    let currentAtr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      currentAtr = ((currentAtr * (period - 1)) + trs[i]) / period; 
    }
    return currentAtr || 0;
  },
  
  adx: (highs, lows, closes, period = 14) => {
    if (!closes || closes.length < period * 2) return 0;
    let trs = [], plusDMs = [], minusDMs = [];
    for (let i = 1; i < closes.length; i++) {
      trs.push(QuantMath.trueRange(highs[i], lows[i], closes[i-1]));
      const upMove = highs[i] - highs[i-1];
      const downMove = lows[i-1] - lows[i];
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    let smoothedTR = trs.slice(0, period).reduce((a,b)=>a+b,0);
    let smoothedPlusDM = plusDMs.slice(0, period).reduce((a,b)=>a+b,0);
    let smoothedMinusDM = minusDMs.slice(0, period).reduce((a,b)=>a+b,0);
    
    let dxs = [];
    for (let i = period; i < trs.length; i++) {
      smoothedTR = smoothedTR - (smoothedTR/period) + trs[i];
      smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM/period) + plusDMs[i];
      smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM/period) + minusDMs[i];
      const plusDI = 100 * (smoothedPlusDM / smoothedTR);
      const minusDI = 100 * (smoothedMinusDM / smoothedTR);
      const dx = 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1);
      dxs.push(dx || 0);
    }
    
    let adx = dxs.slice(0, period).reduce((a,b)=>a+b,0) / period;
    for (let i = period; i < dxs.length; i++) {
      adx = ((adx * (period - 1)) + dxs[i]) / period; 
    }
    return adx || 0;
  },
  
  rsi: (closes, period = 14) => {
    if (!closes || closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i-1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i-1];
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  },
  
  bollinger: (closes, period = 20, stdDev = 2) => {
    if (!closes || closes.length < period) return { bbw: 0, upper: 0, lower: 0, sma: 0 };
    const slice = closes.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
    const dev = Math.sqrt(variance);
    const upper = sma + (stdDev * dev);
    const lower = sma - (stdDev * dev);
    const bbw = ((upper - lower) / sma) * 100; 
    return { bbw, upper, lower, sma };
  },

  percentileRank: (currentValue, historicalArray) => {
    if (!historicalArray || historicalArray.length === 0) return 50;
    const belowCount = historicalArray.filter(val => val < currentValue).length;
    return (belowCount / historicalArray.length) * 100;
  },
  
  obv: (closes, volumes) => { 
    if (!closes || closes.length < 2) return 0;
    let obv = 0;
    for (let j = 1; j < closes.length; j++) {
      if (closes[j] > closes[j-1]) obv += volumes[j];
      else if (closes[j] < closes[j-1]) obv -= volumes[j];
    }
    return obv;
  },

  cmf: (highs, lows, closes, volumes, period = 20) => { 
    if (!closes || closes.length < period) return 0;
    let mfValues = [];
    for (let j = 0; j < closes.length; j++) {
      const clv = ((closes[j] - lows[j]) - (highs[j] - closes[j])) / (highs[j] - lows[j] || 1);
      mfValues.push(clv * volumes[j]);
    }
    const recentMfSum = mfValues.slice(-period).reduce((a, b) => a + b, 0);
    const recentVolSum = volumes.slice(-period).reduce((a, b) => a + b, 0);
    return recentMfSum / (recentVolSum || 1);
  },
  
  costDrag: (entryPrice, tradeType, direction, entryExecution, exitExecution, fundingRate, spreadPercent, holdingCycles = 1, makerFee = 0.0002, takerFee = 0.0004, interval = '1h', obi = 0.5) => { 
    let slippagePenalty = 0;
    if (entryExecution === 'MARKET') {
        if (direction === 'LONG' && obi < 0.4) slippagePenalty = 0.0015; 
        if (direction === 'SHORT' && obi > 0.6) slippagePenalty = 0.0015; 
    }
    const entrySlippage = entryExecution === 'MARKET' ? (0.001 + slippagePenalty) : 0; 
    const entryFee = entryExecution === 'MARKET' ? takerFee : makerFee;
    
    const exitSlippage = exitExecution === 'MARKET' ? 0.001 : 0; 
    const exitFee = exitExecution === 'MARKET' ? takerFee : makerFee;

    const spreadCost = (spreadPercent / 100) / 2;
    
    const intervalToHours = { '5m': 5/60, '15m': 15/60, '1h': 1, '4h': 4, '1d': 24 }; // Xóa 1w
    const hoursPerCandle = intervalToHours[interval] || 1;
    const totalHoldingHours = holdingCycles * hoursPerCandle;
    const realFundingCycles = totalHoldingHours / 8; 
    
    let fundingImpact = 0;
    if (tradeType === 'FUTURES') {
       if (direction === 'LONG') {
           fundingImpact = fundingRate * realFundingCycles; 
       } else {
           fundingImpact = -fundingRate * realFundingCycles; 
       }
    }
    
    const entryCostPerCoin = (entrySlippage + entryFee + spreadCost) * entryPrice;
    const exitCostPerCoin = (exitSlippage + exitFee + spreadCost) * entryPrice;

    return entryCostPerCoin + exitCostPerCoin + (fundingImpact * entryPrice); 
  },

  trueEV: (winRate, reward, lossRate, risk) => {
     return (winRate * reward) - (lossRate * risk);
  },
  
  kellyCriterion: (winRate, historicalAvgRR, nTrades = 0) => {
    if (nTrades < 5) return 0.02; 
    if(winRate === 0 || historicalAvgRR === 0) return 0.01; 
    
    const fullKelly = winRate - ((1 - winRate) / historicalAvgRR);
    let halfKelly = Math.max(0, fullKelly * 0.5); 
    if (nTrades < 30) {
      const penalty = Math.max(0.15, nTrades / 30); 
      halfKelly = halfKelly * penalty;
    }
    return halfKelly;
  },

  scanEmaRange: (closesArray, fastPeriod, slowPeriod, lookback = 20, atrValue = 0) => {
      if (!closesArray || closesArray.length < Math.max(fastPeriod, slowPeriod) + lookback) {
         return { fastEmaCurrent: 0, slowEmaCurrent: 0, fastSlope: 0, slowSlope: 0, isCrossBull: false, isCrossBear: false, spreadPercent: 0, normFastSlope: 0, normSlowSlope: 0 };
      }
      const fastEmaCurrent = QuantMath.ema(closesArray, fastPeriod);
      const slowEmaCurrent = QuantMath.ema(closesArray, slowPeriod);
      
      const pastCloses = closesArray.slice(0, -lookback);
      const fastEmaPast = QuantMath.ema(pastCloses, fastPeriod);
      const slowEmaPast = QuantMath.ema(pastCloses, slowPeriod);

      const fastSlope = fastEmaPast > 0 ? ((fastEmaCurrent - fastEmaPast) / fastEmaPast) * 100 : 0;
      const slowSlope = slowEmaPast > 0 ? ((slowEmaCurrent - slowEmaPast) / slowEmaPast) * 100 : 0;
      
      const normFastSlope = (atrValue > 0 && fastEmaPast > 0) ? (fastEmaCurrent - fastEmaPast) / atrValue : fastSlope;
      const normSlowSlope = (atrValue > 0 && slowEmaPast > 0) ? (slowEmaCurrent - slowEmaPast) / atrValue : slowSlope;

      const isCrossBull = (fastEmaPast < slowEmaPast) && (fastEmaCurrent > slowEmaCurrent);
      const isCrossBear = (fastEmaPast > slowEmaPast) && (fastEmaCurrent < slowEmaCurrent);
      
      const spreadPercent = slowEmaCurrent > 0 ? Math.abs(fastEmaCurrent - slowEmaCurrent) / slowEmaCurrent * 100 : 0;

      return { fastEmaCurrent, slowEmaCurrent, fastSlope, slowSlope, isCrossBull, isCrossBear, spreadPercent, normFastSlope, normSlowSlope };
  },
  
  detectSFP_Advanced: (highs, lows, closes, volumes, avgVolume, direction) => {
    if (!closes || closes.length < 10 || !volumes) return false;
    const triggerIndex = closes.length - 2; 
    const triggerClose = closes[triggerIndex];
    const triggerHigh = highs[triggerIndex];
    const triggerLow = lows[triggerIndex];
    const triggerVol = volumes[triggerIndex];

    // Bắt buộc Volume phải cao hơn 20% so với trung bình để xác nhận là cá mập quét râu
    if (triggerVol < avgVolume * 1.2) return false;

    let lastPivotHigh = -1;
    let lastPivotLow = Infinity;

    for (let j = triggerIndex - 3; j >= 2; j--) {
        if (highs[j] > highs[j-1] && highs[j] > highs[j-2] && 
            highs[j] > highs[j+1] && highs[j] > highs[j+2]) {
            lastPivotHigh = highs[j];
            break; 
        }
    }

    for (let j = triggerIndex - 3; j >= 2; j--) {
        if (lows[j] < lows[j-1] && lows[j] < lows[j-2] && 
            lows[j] < lows[j+1] && lows[j] < lows[j+2]) {
            lastPivotLow = lows[j];
            break;
        }
    }

    if (direction === 'SHORT') {
        return (lastPivotHigh !== -1 && triggerHigh > lastPivotHigh && triggerClose < lastPivotHigh);
    } else {
        return (lastPivotLow !== Infinity && triggerLow < lastPivotLow && triggerClose > lastPivotLow);
    }
  },

  dynamicAsymmetricTargets: (bbwRank, bbwSlope, isSfp, atrPercent, obi, direction) => {
      let tpMult = 2.0; 
      let slMult = 1.5; 
      let strategyName = "TIÊU CHUẨN (R:R 1:1.3+)";

      const noiseBuffer = atrPercent > 2.0 ? 0.2 : 0;

      if (bbwRank <= 15 && bbwSlope > 10) {
          tpMult = 7.0; 
          slMult = 1.0 + noiseBuffer; 
          strategyName = "🚀 X10 SQUEEZE BREAKOUT";
      }
      else if (isSfp) {
          if ((direction === 'LONG' && obi > 0.70) || (direction === 'SHORT' && obi < 0.30)) {
              tpMult = 4.0; 
              slMult = 0.6 + (noiseBuffer / 2); 
              strategyName = "🎯 X5 SNIPER SFP";
          }
      }
      else if (obi > 0.85 || obi < 0.15) {
          tpMult = 3.0;
          slMult = 1.2 + noiseBuffer;
          strategyName = "🐳 WHALE IMBALANCE (X3)";
      }

      return { tpMult, slMult, strategyName };
  },

  estimateLiquidation: (notionalUSD, leverage, entry, direction, brackets) => {
    if (!brackets || brackets.length === 0 || !leverage) return null;
    const tier = brackets.find(b => notionalUSD >= b.notionalFloor && notionalUSD < b.notionalCap) 
                 || brackets[brackets.length - 1]; 
    const mmr = tier.maintMarginRatio;
    const maxLevForTier = tier.initialLeverage; 

    const liqPrice = direction === 'LONG'
      ? entry * (1 - (1 / leverage) + mmr)
      : entry * (1 + (1 / leverage) - mmr);

    return { liqPrice, mmr, maxLevForTier, bracket: tier.bracket };
  }
};

export default QuantMath;
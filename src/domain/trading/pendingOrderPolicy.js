import { STRATEGY_CATALOG } from './strategyRouter.js';

/**
 * Milliseconds per timeframe mapping.
 * Supports: '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w'.
 */
export const TIMEFRAME_MS_MAP = Object.freeze({
  '1m': 60 * 1000,
  '3m': 3 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000
});

/**
 * Parses a timeframe string or numeric duration to milliseconds.
 *
 * @param {string|number} timeframe - e.g. '15m', '1h', '4h', '1d', etc.
 * @returns {number} duration in milliseconds, or NaN if invalid.
 */
export function parseTimeframeToMs(timeframe) {
  if (typeof timeframe === 'number' && Number.isFinite(timeframe) && timeframe > 0) {
    return timeframe;
  }
  if (typeof timeframe !== 'string') {
    return NaN;
  }
  const key = timeframe.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(TIMEFRAME_MS_MAP, key)) {
    return TIMEFRAME_MS_MAP[key];
  }
  const match = key.match(/^(\d+)([mhdw])$/);
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2];
    const unitMult = {
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000
    };
    if (unitMult[unit]) {
      return val * unitMult[unit];
    }
  }
  return NaN;
}

/**
 * Calculates expiry timestamp in ms based on candle count.
 *
 * @param {string|number} timeframe - e.g. '15m', '1h', etc.
 * @param {number|string|Date} createdAt - Timestamp when order was placed.
 * @param {number} [candlesCount=3] - Number of candles until expiration.
 * @returns {number} Expiration timestamp in ms, or NaN if input is invalid.
 */
export function calculateCandleExpiryMs(timeframe, createdAt, candlesCount = 3) {
  const tfMs = parseTimeframeToMs(timeframe);
  if (Number.isNaN(tfMs)) return NaN;

  let createdMs;
  if (typeof createdAt === 'number') {
    createdMs = createdAt;
  } else if (typeof createdAt === 'string') {
    createdMs = new Date(createdAt).getTime();
  } else if (createdAt instanceof Date) {
    createdMs = createdAt.getTime();
  } else {
    return NaN;
  }

  if (!Number.isFinite(createdMs)) return NaN;

  const count = typeof candlesCount === 'number' && Number.isFinite(candlesCount) ? candlesCount : 3;
  return createdMs + (tfMs * count);
}

/**
 * Checks whether a pending order has expired based on candle duration policy.
 *
 * @param {Object} order - Order object containing timeframe and createdAt.
 * @param {number} [currentTimeMs=Date.now()] - Current timestamp in ms.
 * @param {number} [candlesCount=3] - Fallback candles count if not specified in order.
 * @returns {boolean} True if order is expired, false otherwise.
 */
export function isPendingOrderExpired(order, currentTimeMs = Date.now(), candlesCount = 3) {
  if (!order || typeof order !== 'object') return false;

  const timeframe = order.timeframe || order.timeFrame;
  const createdAt = order.createdAt ?? order.created_at ?? order.timestamp ?? order.createdTime;
  const count = order.candlesCount ?? candlesCount;

  if (!timeframe || createdAt === undefined || createdAt === null) return false;

  const expiryMs = calculateCandleExpiryMs(timeframe, createdAt, count);
  if (Number.isNaN(expiryMs)) return false;

  const nowMs = typeof currentTimeMs === 'number'
    ? currentTimeMs
    : (new Date(currentTimeMs)).getTime();

  return nowMs >= expiryMs;
}

/**
 * Evaluates market snapshot against a pending order to determine if any hard gate,
 * soft score condition, strategy policy rule, or ATR expansion condition invalidates the order.
 *
 * @param {Object} order - Pending order details.
 * @param {Object} marketSnapshot - Current market state.
 * @param {Array} [strategyCatalog=STRATEGY_CATALOG] - List of available strategy definitions.
 * @returns {Object} Evaluation result with isInvalidated, reasons, invalidatedGates, and details.
 */
export function evaluatePendingOrderGateInvalidation(order, marketSnapshot, strategyCatalog = STRATEGY_CATALOG) {
  if (!order || typeof order !== 'object') {
    return {
      isInvalidated: true,
      reasons: ['INVALID_ORDER_OBJECT'],
      invalidatedGates: ['order_validity'],
      details: {}
    };
  }

  if (!marketSnapshot || typeof marketSnapshot !== 'object') {
    return {
      isInvalidated: true,
      reasons: ['INVALID_MARKET_SNAPSHOT'],
      invalidatedGates: ['snapshot_validity'],
      details: {}
    };
  }

  const direction = order.direction || 'LONG';
  const entry = order.entry ?? order.entryPrice ?? 0;
  const slTech = order.slTech ?? order.sl ?? order.stopLoss ?? 0;

  const rawStrategy = typeof order.strategy === 'string'
    ? order.strategy
    : (order.strategyId || order.strategy?.strategyId || order.strategy_name || '');

  const strategyId = rawStrategy.replace(/\s*\[(BOT|SCALP)\]/gi, '').trim();

  const strategyDef = Array.isArray(strategyCatalog)
    ? strategyCatalog.find(s => s.strategyId === strategyId || s.name === strategyId || s.strategyId === rawStrategy)
    : null;

  const policy = strategyDef?.policy
    || (typeof order.strategy === 'object' && order.strategy?.policy)
    || order.policy
    || {};

  // Extract market snapshot layers
  const autoData = marketSnapshot.autoData || marketSnapshot;
  const apiMacro = marketSnapshot.apiMacro || marketSnapshot;
  const vectorDetails = marketSnapshot.vectorDetails || marketSnapshot;

  const msbState = autoData.msbState ?? marketSnapshot.msbState ?? 'None';
  const vpinValue = autoData.vpinValue ?? marketSnapshot.vpinValue ?? 0;
  const l1 = vectorDetails.l1 ?? autoData.l1 ?? marketSnapshot.l1 ?? '';
  const l2 = vectorDetails.l2 ?? autoData.l2 ?? marketSnapshot.l2 ?? '';
  const l3 = vectorDetails.l3 ?? autoData.l3 ?? marketSnapshot.l3 ?? '';
  const vwapUpper = autoData.vwapUpper ?? marketSnapshot.vwapUpper;
  const vwapLower = autoData.vwapLower ?? marketSnapshot.vwapLower;
  const cvdTrend = autoData.cvdTrend ?? marketSnapshot.cvdTrend ?? 0;
  const hurstValue = autoData.hurstValue ?? marketSnapshot.hurstValue ?? 0.5;
  const cmf = autoData.cmf ?? marketSnapshot.cmf ?? 0;
  const ema20 = typeof autoData.ema20 === 'object' && autoData.ema20 !== null
    ? autoData.ema20.value
    : (autoData.ema20 ?? marketSnapshot.ema20 ?? entry);
  const atr14 = autoData.atr14 ?? autoData.atr ?? marketSnapshot.atr14 ?? marketSnapshot.atr ?? 0;
  const realSpreadPct = apiMacro.realSpreadPct ?? marketSnapshot.realSpreadPct ?? 0;

  // Policy flag derivations
  const rangeAllowed = policy.allowRange === true || strategyId === 'VOLATILITY_EXTREME_FADE';
  const highVpinAllowed = policy.allowHighVpin === true || strategyId === 'CAPITULATION_RECLAIM' || strategyId === 'PASSIVE_ABSORPTION_REVERSAL';
  const cvdDivergenceAllowed = policy.allowCvdDivergence === true || strategyId === 'PASSIVE_ABSORPTION_REVERSAL' || strategyId === 'CVD_STRUCTURE_DIVERGENCE';
  const requiresTrendPersistence = policy.requiresTrendPersistence === true || strategyId === 'VOL_COMPRESSION_IGNITION' || strategyId === 'LIQUIDITY_VACUUM_DRIVE' || strategyId === 'FLOW_REACCELERATION';

  const l1Str = String(l1);
  const l3Str = String(l3);
  const isRangeRegime = l1Str.includes('Range') || l1Str.includes('Mean Reversion') || l1Str.includes('Chop');
  const isCmfAligned = (direction === 'LONG' && cmf > 0) || (direction === 'SHORT' && cmf < 0);
  const isOverextendedEMA20 = Math.abs(entry - ema20) > (atr14 * 1.5);
  const isMsbContradictory = (direction === 'LONG' && msbState === 'Bearish_MSB') ||
                             (direction === 'SHORT' && msbState === 'Bullish_MSB');

  const isVpinSafe = vpinValue <= 0.10 || highVpinAllowed;
  const isVwapSafe = direction === 'LONG'
    ? (vwapUpper === undefined || entry < vwapUpper)
    : (vwapLower === undefined || entry > vwapLower);
  const isCvdAligned = cvdDivergenceAllowed || (direction === 'LONG' ? cvdTrend > -5 : cvdTrend < 5);

  // Evaluate hard gates
  const hardGates = [
    { id: 'h1', passed: realSpreadPct < 0.3 && slTech > 0 && Math.abs(entry - slTech) > (atr14 * 0.4), text: 'CHỐNG NHIỄU: Khoảng cách SL > 0.4 ATR và spread < 0.3%' },
    { id: 'h_msb', passed: !isMsbContradictory, text: 'MARKET STRUCTURE: MSB đảo chiều ngược hướng' },
    { id: 'h_vpin', passed: isVpinSafe, text: 'TOXIC FLOW: VPIN > 0.10' },
    { id: 'h_range_block', passed: !isRangeRegime || rangeAllowed, text: 'L1 RANGE BLOCK: Không được giao dịch trong Range trừ family mean-reversion' },
    { id: 'h_vwap', passed: isVwapSafe, text: 'VWAP GRAVITY: Giá đi quá xa VWAP Bands' },
    { id: 'h_cvd', passed: isCvdAligned, text: 'CVD DIVERGENCE: Taker flow xả ngược hướng' },
    { id: 'h_expansion_fomo', passed: !(l2 === 'Expansion' && isOverextendedEMA20), text: 'FOMO FILTER: Mua/bán đuổi khi L2 Expansion và xa EMA20' },
    { id: 'h_cmf_breakout', passed: !(l3Str.includes('Break') && !isCmfAligned), text: 'CMF BREAKOUT: Breakout không có CMF đồng thuận' },
    { id: 'h_hurst', passed: !(hurstValue < 0.4 && requiresTrendPersistence), text: 'HURST EXPONENT: Hurst < 0.4 trên momentum family' }
  ];

  const invalidatedGates = [];
  const reasons = [];

  for (const gate of hardGates) {
    if (!gate.passed) {
      invalidatedGates.push(gate.id);
      reasons.push(`HARD_GATE_FAILED_${gate.id.toUpperCase()}: ${gate.text}`);
    }
  }

  // Soft score evaluation
  const currentScore = marketSnapshot.systemScore?.score ?? marketSnapshot.softScore ?? marketSnapshot.score ?? marketSnapshot.currentScore;
  const passingScore = order.passingScore ?? marketSnapshot.systemScore?.passingScore ?? marketSnapshot.passingScore ?? 50;
  const initialScore = order.initialScore ?? order.initialSoftScore;

  let scoreBelowPassing = false;
  let scoreDegraded15Pt = false;

  if (typeof currentScore === 'number') {
    if (currentScore < passingScore) {
      scoreBelowPassing = true;
      invalidatedGates.push('soft_score_passing');
      reasons.push(`SOFT_SCORE_BELOW_PASSING: Current score ${currentScore} < passing score ${passingScore}`);
    }
    if (typeof initialScore === 'number' && (initialScore - currentScore) >= 15) {
      scoreDegraded15Pt = true;
      invalidatedGates.push('soft_score_degradation');
      reasons.push(`SOFT_SCORE_DEGRADED_15PT: Score dropped from ${initialScore} to ${currentScore} (>= 15 pts)`);
    }
  }

  // Strategy rule breakdown check
  let strategyFound = !!strategyDef;
  let strategySupported = true;
  let strategyMinScoreMet = true;

  if (strategyId) {
    if (!strategyDef) {
      strategyFound = false;
      invalidatedGates.push('strategy_not_found');
      reasons.push(`STRATEGY_RULE_BREAKDOWN: Strategy ID '${strategyId}' not found in catalog`);
    } else {
      if (Array.isArray(strategyDef.supportedDirections) && !strategyDef.supportedDirections.includes(direction)) {
        strategySupported = false;
        invalidatedGates.push('strategy_unsupported_direction');
        reasons.push(`STRATEGY_RULE_BREAKDOWN: Strategy '${strategyId}' does not support direction '${direction}'`);
      }
      if (typeof strategyDef.profile?.minScore === 'number' && typeof currentScore === 'number' && currentScore < strategyDef.profile.minScore) {
        strategyMinScoreMet = false;
        invalidatedGates.push('strategy_min_score');
        reasons.push(`STRATEGY_RULE_BREAKDOWN: Current score ${currentScore} < strategy minScore ${strategyDef.profile.minScore}`);
      }
    }
  }

  // ATR expansion +50% check
  const initialAtr = order.initialAtr ?? order.entryAtr ?? order.atr14;
  const currentAtr = atr14;
  let atrExpanded50Pct = false;

  if (typeof initialAtr === 'number' && initialAtr > 0 && typeof currentAtr === 'number' && currentAtr > 0) {
    if (currentAtr >= initialAtr * 1.5) {
      atrExpanded50Pct = true;
      invalidatedGates.push('atr_expansion_50pct');
      reasons.push(`ATR_EXPANSION_50PCT: Current ATR ${currentAtr} expanded by >= 50% over initial ATR ${initialAtr}`);
    }
  }

  const isInvalidated = invalidatedGates.length > 0;

  return {
    isInvalidated,
    reasons,
    invalidatedGates,
    details: {
      hardGates,
      softScoreStatus: {
        currentScore: currentScore ?? null,
        initialScore: initialScore ?? null,
        passingScore,
        scoreBelowPassing,
        scoreDegraded15Pt
      },
      strategyStatus: {
        strategyId,
        found: strategyFound,
        supported: strategySupported,
        minScoreMet: strategyMinScoreMet
      },
      atrStatus: {
        initialAtr: initialAtr ?? null,
        currentAtr: currentAtr ?? null,
        expanded50Pct: atrExpanded50Pct
      }
    }
  };
}

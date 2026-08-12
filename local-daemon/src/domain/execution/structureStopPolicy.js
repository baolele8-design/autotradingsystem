// F-E2a (2026-08-12): SL structure SHADOW policy â€” computes what the initial
// stop WOULD be if the last swing level (lastSL for LONG / lastSH for SHORT)
// were used instead of the ATR multiple. Shadow/payload-only: the live SL
// path (slTech/riskDiffTech/size in matrixScannerService) is untouched.
//
// Osler (2000) stop-cluster research: retail stops cluster 0.1â€“0.3% beyond
// swing points, so the stop must clear the level by a buffer that scales with
// the instrument â€” buffer = max(bufferAtrRatio*ATR, 2*tickSize) instead of a
// fixed 7bps (which would sit inside the swept cluster zone for many coins).
//
// Fail-open contract: never throws; any missing/invalid required input yields
// { applied: 'ATR', reason: 'INVALID' } so the caller keeps the live ATR stop.

const isValidNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// "Äá»“ng hÆ°á»›ng" (same-direction) definition for the momentum gate:
// LONG: regime 'Uptrend' OR msbState 'Bullish_MSB'; SHORT mirrored.
// Range/Sideways/null regimes never count as aligned.
const isRegimeAligned = (direction, { msbRegime, msbState }) => {
  if (direction === 'LONG') {
    return msbRegime === 'Uptrend' || msbState === 'Bullish_MSB';
  }
  if (direction === 'SHORT') {
    return msbRegime === 'Downtrend' || msbState === 'Bearish_MSB';
  }
  return false;
};

export const computeStructureStop = ({
  direction,
  entry,
  atr,
  slDistanceAtr,
  lastSL,
  lastSH,
  swingAge,
  adx,
  msbRegime,
  msbState,
  bufferAtrRatio = 0.05,
  minAtrFloor = 0.5,
  maxAgeBars = 20,
  adxMin = 20,
  tickSize
} = {}) => {
  const fail = (reason, slAtr = null) => ({
    stopPrice: slAtr,
    applied: 'ATR',
    reason,
    slAtr,
    slStruct: null,
    distance: slAtr !== null ? Math.abs(slAtr - entry) : 0,
    bufferUsed: null,
    momentumSource: null
  });

  // ---- required-field guard (fail-open, never throw) ----
  if (
    (direction !== 'LONG' && direction !== 'SHORT') ||
    !isValidNumber(entry) || entry <= 0 ||
    !isValidNumber(atr) || atr <= 0 ||
    !isValidNumber(slDistanceAtr) || slDistanceAtr <= 0
  ) {
    return fail('INVALID');
  }

  const isLong = direction === 'LONG';
  const level = isLong ? lastSL : lastSH;
  const levelPrice = level && isValidNumber(level.price) ? level.price : null;

  // ---- baseline ATR stop ----
  const slAtr = isLong
    ? entry - slDistanceAtr * atr
    : entry + slDistanceAtr * atr;

  // ---- buffer: max(ratio*ATR, 2*tickSize) ----
  const tickBuffer = isValidNumber(tickSize) && tickSize > 0 ? 2 * tickSize : 0;
  const bufferUsed = Math.max(bufferAtrRatio * atr, tickBuffer);

  // ---- level guards ----
  if (levelPrice === null) return fail('NO_LEVEL', slAtr);
  if (isLong ? levelPrice >= entry : levelPrice <= entry) {
    return fail('LEVEL_CROSSED', slAtr);
  }
  if (!isValidNumber(swingAge) || swingAge > maxAgeBars) {
    return fail('STALE', slAtr);
  }

  // ---- momentum gate (pass reason separated for the shadow log) ----
  const momentumSource = isValidNumber(adx) && adx >= adxMin
    ? 'MOMENTUM'
    : isRegimeAligned(direction, { msbRegime, msbState })
      ? 'REGIME'
      : null;
  if (momentumSource === null) return fail('NO_MOMENTUM', slAtr);

  // ---- structure stop + tightness guard ----
  const slStruct = isLong
    ? levelPrice - bufferUsed
    : levelPrice + bufferUsed;
  const structDistance = Math.abs(entry - slStruct);
  if (structDistance < minAtrFloor * atr) {
    return { ...fail('TOO_TIGHT', slAtr), slStruct, bufferUsed };
  }

  // ---- choose the tighter stop in price space ----
  // LONG: stop sits below entry â†’ higher price = closer = tighter â†’ max.
  // SHORT: stop sits above entry â†’ lower price = closer = tighter â†’ min.
  const stopPrice = isLong ? Math.max(slAtr, slStruct) : Math.min(slAtr, slStruct);
  const applied = stopPrice === slStruct ? 'STRUCTURE' : 'ATR';

  return {
    stopPrice,
    applied,
    reason: 'OK',
    slAtr,
    slStruct,
    distance: Math.abs(stopPrice - entry),
    bufferUsed,
    momentumSource: applied === 'STRUCTURE' ? momentumSource : null
  };
};

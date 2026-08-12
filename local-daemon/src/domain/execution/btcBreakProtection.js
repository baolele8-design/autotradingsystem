// =====================================================================
// BTC Break Protection (A2/A1) — portfolio-level risk when BTC breaks
// support/resistance on the 5m close.
//
// Domain-pure module: no external imports, no I/O. All values are
// Binance kline arrays [openTime, open, high, low, close, volume,
// closeTime, ...] as normalized by marketDataCache.normalizeKline
// (d[2]=high, d[3]=low, d[4]=close, d[6]=closeTime).
//
// Fail-closed by design: stale data, missing levels or not enough
// candles never produce a break signal.
// =====================================================================

export const BTC_BREAK_LOOKBACK_N = 20; // nến 5m cho support/resistance
export const BTC_BREAK_CONFIRM_CANDLES = 2; // nến đóng liên tiếp vượt level
export const BTC_BREAK_BUFFER_BPS = 5; // break phải vượt level >= 5bps
export const BTC_BREAK_COOLDOWN_MS = 4 * 60 * 60 * 1000; // one-shot 4h global cả 2 kind
export const BTC_BREAK_BURST_LIMIT = 3; // max symbols đóng/cycle
export const BTC_BREAK_STALE_TOLERANCE_MS = 5 * 60_000 + 30_000; // fail-closed
export const EXIT_REASON_BTC_BREAK = 'PORTFOLIO_TP_BTC_BREAK';
export const BTC_BREAK_CAP_R = 1.0; // cap SL lệnh đỏ cùng chiều rủi ro về 1R

// F-D3: SL cap khi BTC break — nhánh vị thế ĐỎ (không đóng, chỉ cắt SL về
// entry ± initialRiskPerCoin * capR). Thuần: không I/O, không import.
export function computeBtcBreakCapStop({ entry, initialRiskPerCoin, direction, capR = BTC_BREAK_CAP_R }) {
  if (!Number.isFinite(entry) || entry <= 0 ||
      !Number.isFinite(initialRiskPerCoin) || initialRiskPerCoin <= 0 ||
      !Number.isFinite(capR) || capR <= 0) return null;
  const side = String(direction || '').toUpperCase();
  if (side !== 'LONG' && side !== 'SHORT') return null;
  const distance = initialRiskPerCoin * capR;
  return side === 'LONG' ? entry - distance : entry + distance;
}

export function closedCandles(klines, now = Date.now()) {
  if (!Array.isArray(klines)) return [];
  return klines.filter(
    candle => candle && Number(candle[6]) <= now
  );
}

// Cửa sổ level = N nến ĐỨNG TRƯỚC confirm candles (loại confirm khỏi cửa sổ —
// nến phá KHÔNG được tự hạ level). support = min(low), resistance = max(high).
export function computeSupportResistance(
  closed,
  lookbackN = BTC_BREAK_LOOKBACK_N,
  confirm = BTC_BREAK_CONFIRM_CANDLES
) {
  if (!Array.isArray(closed)) return null;
  const windowEnd = closed.length - confirm; // exclusive — confirm candles bị loại
  if (windowEnd < 0) return null;
  const windowStart = Math.max(0, windowEnd - lookbackN);
  const window = closed.slice(windowStart, windowEnd);
  if (window.length < 2) return null;

  let support = Infinity;
  let resistance = -Infinity;
  for (const candle of window) {
    const low = Number.parseFloat(candle?.[3]);
    const high = Number.parseFloat(candle?.[2]);
    if (Number.isFinite(low)) support = Math.min(support, low);
    if (Number.isFinite(high)) resistance = Math.max(resistance, high);
  }
  if (!Number.isFinite(support) || !Number.isFinite(resistance)) return null;
  return { support, resistance };
}

// 'BELOW': nến đóng liên tiếp từ cuối với close <= level*(1 - bufferBps/10000);
// 'ABOVE': close >= level*(1 + bufferBps/10000). Chỉ tính close, không tính wick.
export function hasBreakConfirmed(
  closed,
  level,
  direction,
  confirm = BTC_BREAK_CONFIRM_CANDLES,
  bufferBps = BTC_BREAK_BUFFER_BPS
) {
  if (!Array.isArray(closed) || !Number.isFinite(level)) return false;
  if (direction !== 'BELOW' && direction !== 'ABOVE') return false;
  const bufferFactor = direction === 'ABOVE'
    ? 1 + bufferBps / 10000
    : 1 - bufferBps / 10000;
  const boundary = level * bufferFactor;

  const tail = closed.slice(-confirm);
  if (tail.length < confirm) return false;
  return tail.every(candle => {
    const close = Number.parseFloat(candle?.[4]);
    if (!Number.isFinite(close)) return false;
    return direction === 'ABOVE'
      ? close >= boundary
      : close <= boundary;
  });
}

export function evaluateBtcBreak({
  klines,
  lookbackN,
  confirm,
  now = Date.now()
}) {
  const closed = closedCandles(klines, now);
  if (closed.length < 2) return { kind: null };

  const lastCloseTime = Number(closed[closed.length - 1][6]);
  if (
    !Number.isFinite(lastCloseTime) ||
    now - lastCloseTime > BTC_BREAK_STALE_TOLERANCE_MS
  ) {
    return { kind: null };
  }

  const { support, resistance } =
    computeSupportResistance(closed, lookbackN, confirm) || {};
  if (!Number.isFinite(support) || !Number.isFinite(resistance)) {
    return { kind: null };
  }

  if (hasBreakConfirmed(closed, support, 'BELOW', confirm)) {
    return { kind: 'SUPPORT_BREAK', support, resistance };
  }
  if (hasBreakConfirmed(closed, resistance, 'ABOVE', confirm)) {
    return { kind: 'RESISTANCE_BREAK', support, resistance };
  }
  return { kind: null };
}

// SUPPORT_BREAK → chỉ LONG, RESISTANCE_BREAK → chỉ SHORT; trade phải OPEN.
export function selectBtcBreakSymbols(candidates, openTrades, kind) {
  if (!Array.isArray(candidates) || !Array.isArray(openTrades)) return [];
  const wantedDirection =
    kind === 'SUPPORT_BREAK'
      ? 'LONG'
      : kind === 'RESISTANCE_BREAK'
        ? 'SHORT'
        : null;
  if (!wantedDirection) return [];

  return candidates.filter(candidate =>
    openTrades.some(trade =>
      trade?.symbol === candidate?.symbol &&
      String(trade.status || '').toUpperCase() === 'OPEN' &&
      String(trade.direction || '').toUpperCase() === wantedDirection
    )
  );
}

// Cooldown global cho cả 2 kind: sau recordTrigger, canTrigger() chỉ mở lại
// sau cooldownMs (mặc định 4h).
export function createBtcBreakCooldown(
  cooldownMs = BTC_BREAK_COOLDOWN_MS,
  now = () => Date.now()
) {
  let triggeredAt = null;
  return {
    canTrigger() {
      if (triggeredAt === null) return true;
      return now() - triggeredAt >= cooldownMs;
    },
    recordTrigger() {
      triggeredAt = now();
    }
  };
}

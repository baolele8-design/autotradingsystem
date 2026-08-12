// F-E3 (2026-08-12): nearest swing-level lookup for TP/MSB payloads.
// Shadow/payload-only — never changes tp1, TradeValidator or trailingPolicy.
//
// Fractal detection is a verbatim copy of the 5-bar fractal condition from
// indicators.js:338-351 (detectMarketStructure): a swing high needs
// highs[i] > highs[i-1], highs[i-2], highs[i+1], highs[i+2]; swing lows mirror.
// The parity test (structureLevels.test.js) proves both produce the same
// swing list on the same fixture. All helpers are pure and fail-open: no
// level found → null, never throws.

const isValidNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export const findSwingHighs = (highs) => {
  if (!Array.isArray(highs) || highs.length < 5) return [];
  const swings = [];
  for (let i = 2; i < highs.length - 2; i++) {
    if (
      highs[i] > highs[i - 1] && highs[i] > highs[i - 2] &&
      highs[i] > highs[i + 1] && highs[i] > highs[i + 2]
    ) {
      swings.push({ index: i, price: highs[i] });
    }
  }
  return swings;
};

export const findSwingLows = (lows) => {
  if (!Array.isArray(lows) || lows.length < 5) return [];
  const swings = [];
  for (let i = 2; i < lows.length - 2; i++) {
    if (
      lows[i] < lows[i - 1] && lows[i] < lows[i - 2] &&
      lows[i] < lows[i + 1] && lows[i] < lows[i + 2]
    ) {
      swings.push({ index: i, price: lows[i] });
    }
  }
  return swings;
};

// Nearest level in PRICE space within the lookback window (index >= len -
// lookback). distAtr = (level - entry) / atr for resistance, mirrored for
// support; null when atr is missing/non-positive or no level qualifies.
export const findNearestResistance = (highs, closes, entry, { lookback = 40, atr } = {}) => {
  if (!Array.isArray(highs) || !Array.isArray(closes) || !isValidNumber(entry)) return null;
  const len = Math.min(highs.length, closes.length);
  if (len < 5) return null;
  const windowStart = Math.max(2, len - lookback);
  let nearest = null;
  for (const swing of findSwingHighs(highs.slice(0, len))) {
    if (swing.index < windowStart) continue;
    if (!(swing.price > entry)) continue;
    if (nearest === null || swing.price - entry < nearest.price - entry) {
      nearest = swing;
    }
  }
  if (nearest === null) return null;
  return {
    price: nearest.price,
    index: nearest.index,
    distAtr: isValidNumber(atr) && atr > 0 ? (nearest.price - entry) / atr : null
  };
};

export const findNearestSupport = (lows, closes, entry, { lookback = 40, atr } = {}) => {
  if (!Array.isArray(lows) || !Array.isArray(closes) || !isValidNumber(entry)) return null;
  const len = Math.min(lows.length, closes.length);
  if (len < 5) return null;
  const windowStart = Math.max(2, len - lookback);
  let nearest = null;
  for (const swing of findSwingLows(lows.slice(0, len))) {
    if (swing.index < windowStart) continue;
    if (!(swing.price < entry)) continue;
    if (nearest === null || entry - swing.price < entry - nearest.price) {
      nearest = swing;
    }
  }
  if (nearest === null) return null;
  return {
    price: nearest.price,
    index: nearest.index,
    distAtr: isValidNumber(atr) && atr > 0 ? (entry - nearest.price) / atr : null
  };
};

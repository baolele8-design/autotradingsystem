export const EXCURSION_PATH_VERSION = 'r-path-1m/v2';

const DEFAULT_RESOLUTION_R = 0.25;
const DEFAULT_MAX_EVENTS = 96;
const DEFAULT_THRESHOLDS_R = Object.freeze([
  0.25, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.90,
  1.00, 1.05, 1.20, 1.50, 1.60, 1.80, 2.00, 2.50
]);

const finitePositive = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const quantize = (value, resolution) => {
  const result = Math.round(value / resolution) * resolution;
  return Object.is(result, -0) ? 0 : result;
};

const compactEvents = (events, maximum) => {
  if (events.length <= maximum) return events;
  const mandatory = new Map();
  const keep = event => {
    if (mandatory.size < maximum || mandatory.has(event.i)) {
      mandatory.set(event.i, event);
    }
  };
  [
    events[0],
    events.at(-1),
    events.reduce((best, event) => event.f > best.f ? event : best),
    events.reduce((worst, event) => event.a < worst.a ? event : worst),
    events.reduce((best, event) => event.c > best.c ? event : best),
    events.reduce((worst, event) => event.c < worst.c ? event : worst)
  ].forEach(keep);

  const remainingSlots = maximum - mandatory.size;
  if (remainingSlots > 0) {
    const candidates = events.filter(event => !mandatory.has(event.i));
    const stride = candidates.length / remainingSlots;
    for (let index = 0; index < remainingSlots; index += 1) {
      keep(candidates[Math.min(
        candidates.length - 1,
        Math.floor((index + 0.5) * stride)
      )]);
    }
  }
  return [...mandatory.values()].sort((left, right) => left.i - right.i);
};

const buildThresholdCrossings = (ranges, thresholds) =>
  Object.fromEntries(thresholds.map(threshold => {
    const firstReachIndex = ranges.findIndex(range => range.f >= threshold);
    if (firstReachIndex < 0) {
      return [String(threshold), {
        first_reach: null,
        first_retrace_below_entry: null,
        same_candle_order_ambiguous: false
      }];
    }
    const firstReach = firstReachIndex + 1;
    const firstRetraceIndex = ranges.findIndex((range, index) =>
      index >= firstReachIndex && range.a <= 0
    );
    return [String(threshold), {
      first_reach: firstReach,
      first_retrace_below_entry:
        firstRetraceIndex < 0 ? null : firstRetraceIndex + 1,
      same_candle_order_ambiguous:
        ranges[firstReachIndex].a <= 0
    }];
  }));

/**
 * Builds a bounded, lossy lifecycle path from candles already fetched for
 * MFE/MAE enrichment. No additional exchange request is required.
 *
 * Each event stores candle index (i), favorable/adverse candle extremes in R
 * (f/a), and close in R (c). Events are emitted only at a new envelope extreme
 * or a close-direction reversal. OHLC cannot prove high/low order within one
 * candle, so consumers must treat same-candle ordering as ambiguous.
 */
export function buildExcursionPath({
  anchorPrice,
  candles,
  direction,
  initialRiskPerCoin,
  maxEvents = DEFAULT_MAX_EVENTS,
  resolutionR = DEFAULT_RESOLUTION_R,
  thresholdsR = DEFAULT_THRESHOLDS_R
}) {
  const anchor = finitePositive(anchorPrice);
  const risk = finitePositive(initialRiskPerCoin);
  const normalizedDirection = String(direction || '').toUpperCase();
  if (
    anchor === null ||
    risk === null ||
    !Array.isArray(candles) ||
    candles.length === 0 ||
    !['LONG', 'SHORT'].includes(normalizedDirection) ||
    !Number.isInteger(maxEvents) ||
    maxEvents < 2 ||
    !Number.isFinite(resolutionR) ||
    resolutionR <= 0 ||
    !Array.isArray(thresholdsR) ||
    thresholdsR.some(value => !Number.isFinite(value) || value <= 0)
  ) {
    return null;
  }

  const sign = normalizedDirection === 'LONG' ? 1 : -1;
  let bestFavorable = -Infinity;
  let worstAdverse = Infinity;
  let priorClose = 0;
  let priorTrend = 0;
  const events = [];
  const ranges = [];

  candles.forEach((candle, index) => {
    const high = Number(candle?.[2]);
    const low = Number(candle?.[3]);
    const close = Number(candle?.[4]);
    if (![high, low, close].every(Number.isFinite)) return;

    const favorable = sign > 0
      ? (high - anchor) / risk
      : (anchor - low) / risk;
    const adverse = sign > 0
      ? (low - anchor) / risk
      : (anchor - high) / risk;
    const closeR = sign * (close - anchor) / risk;
    const qFavorable = quantize(favorable, resolutionR);
    const qAdverse = quantize(adverse, resolutionR);
    const qClose = quantize(closeR, resolutionR);
    ranges.push({ a: adverse, c: closeR, f: favorable });
    const trend = Math.sign(qClose - priorClose);
    const newExtreme =
      qFavorable > bestFavorable || qAdverse < worstAdverse;
    const reversed = trend !== 0 && priorTrend !== 0 && trend !== priorTrend;

    if (index === 0 || newExtreme || reversed || index === candles.length - 1) {
      events.push({
        a: qAdverse,
        c: qClose,
        f: qFavorable,
        i: index + 1
      });
    }
    bestFavorable = Math.max(bestFavorable, qFavorable);
    worstAdverse = Math.min(worstAdverse, qAdverse);
    if (trend !== 0) priorTrend = trend;
    priorClose = qClose;
  });

  if (events.length === 0) return null;
  const compacted = compactEvents(events, maxEvents);
  return {
    ambiguous_within_candle: true,
    candle_count: candles.length,
    event_count_before_compaction: events.length,
    events: compacted,
    ordering: 'candle-event-time',
    resolution_r: resolutionR,
    source_interval: '1m',
    threshold_crossings: buildThresholdCrossings(
      ranges,
      [...new Set(thresholdsR)].sort((left, right) => left - right)
    ),
    truncated: compacted.length < events.length,
    version: EXCURSION_PATH_VERSION
  };
}

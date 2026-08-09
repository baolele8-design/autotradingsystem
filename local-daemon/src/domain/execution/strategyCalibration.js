// FILE: local-daemon/src/domain/execution/strategyCalibration.js
//
// R4 AUTO-CALIBRATE — pure percentile/threshold calibration helpers.
// Domain layer, 0 external deps. OFF-LINE ONLY: deliberately NOT wired into the
// runtime phase (spec 10_reachability_fix_spec.md §4). Run against feature
// dumps (trade_logs_rows.csv + future exports) to re-derive per-direction
// strategy thresholds monthly — supports the R1 threshold calibration loop.
//
// Why excludeZeros matters: cvd_trend is 67.7% zeros in the sample (168/248),
// which skews raw percentiles to 0 (p50=p90=p95=0). Dropping zeros before
// percentile computation recovers the distribution of actual taker flow
// (nonzero p50 = -2.199 in the sample).
//
// Percentile convention: linear interpolation over the sorted sample
// (h = (n-1)*p/100), NOT min/max picking — guards against noise.

const DEFAULT_PERCENTILES = [10, 25, 50, 75, 90, 95];

/**
 * Normalize a percentile to an integer 0-100. Accepts the 0-1 fraction
 * convention (percentile: 0.9 => 90) as well as the integer one (90 => 90).
 * Values in (0,1) are multiplied by 100; 1 is left as-is (p1/p100 ambiguity).
 */
function normalizePercentile(percentile) {
  if (typeof percentile === 'number' && Number.isFinite(percentile) && percentile > 0 && percentile < 1) {
    return percentile * 100;
  }
  return percentile;
}

/**
 * Keep finite numbers only (drops NaN, null, undefined, '', Infinity).
 * With `excludeZeros` also drops exact 0 values. Returns a sorted copy.
 */
export function cleanValues(values, { excludeZeros = false } = {}) {
  const cleaned = [];
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (excludeZeros && v === 0) continue;
    cleaned.push(v);
  }
  return cleaned.sort((a, b) => a - b);
}

/** Single linear-interpolated percentile from a sorted array; null if empty. */
export function percentileValue(sorted, percentile) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * (percentile / 100);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Percentiles of `values`: { p10, p25, p50, p75, p90, p95, sampleSize }.
 * Returns null when no usable value remains after cleaning.
 */
export function computePercentiles(values, { percentiles = DEFAULT_PERCENTILES, excludeZeros = false } = {}) {
  const sorted = cleanValues(values ?? [], { excludeZeros });
  if (sorted.length === 0) return null;
  const result = { sampleSize: sorted.length };
  for (const p of percentiles) {
    result[`p${p}`] = percentileValue(sorted, p);
  }
  return result;
}

/**
 * Suggest a threshold from `values` at a given percentile.
 *
 * direction:
 *   'gte' — candidates fire when value >= threshold (e.g. CVD cvdD >= t)
 *   'lte' — candidates fire when value <= threshold (e.g. PASSIVE cvdD <= t)
 *
 * Returns { threshold, percentileUsed, hitRate, sampleSize, min, max }
 * or null when sampleSize < minSamples (threshold not statistically grounded).
 * hitRate = share of the sample that would pass the threshold
 * (count >= threshold for 'gte', count <= threshold for 'lte').
 */
export function suggestThreshold(values, {
  direction = 'gte',
  percentile = 90,
  minSamples = 20,
  excludeZeros = false
} = {}) {
  const sorted = cleanValues(values ?? [], { excludeZeros });
  const sampleSize = sorted.length;
  if (sampleSize < minSamples) return null;
  const percentileUsed = normalizePercentile(percentile);
  const threshold = percentileValue(sorted, percentileUsed);
  const count = direction === 'lte'
    ? sorted.filter(v => v <= threshold).length
    : sorted.filter(v => v >= threshold).length;
  return {
    threshold,
    percentileUsed,
    hitRate: count / sampleSize,
    sampleSize,
    min: sorted[0],
    max: sorted[sampleSize - 1]
  };
}

/**
 * Per-direction thresholds, mirroring the R1 per-direction pattern
 * (LONG/SHORT have structurally different distributions — one shared threshold
 * cannot serve both). Returns { LONG: {...}|null, SHORT: {...}|null, ... }.
 */
export function suggestThresholdByDirection(valuesByDirection, opts) {
  const result = {};
  for (const [directionKey, values] of Object.entries(valuesByDirection ?? {})) {
    result[directionKey] = suggestThreshold(values, opts);
  }
  return result;
}

/**
 * Calibration report for one feature: suggested thresholds per direction plus
 * the delta vs the currently-configured thresholds (`oldThresholds`), so an
 * operator can see how far the data says the live rule gates should move.
 */
export function calibrateFeatureSet(featureName, valuesByDirection, opts = {}) {
  const {
    direction = 'gte',
    percentile = 90,
    minSamples = 20,
    excludeZeros = false,
    oldThresholds = {}
  } = opts;
  const percentileUsed = normalizePercentile(percentile);
  const suggested = suggestThresholdByDirection(valuesByDirection, {
    direction,
    percentile: percentileUsed,
    minSamples,
    excludeZeros
  });
  const byDirection = {};
  for (const [dir, s] of Object.entries(suggested)) {
    if (s === null) {
      byDirection[dir] = null;
      continue;
    }
    const old = oldThresholds[dir];
    byDirection[dir] = {
      threshold: s.threshold,
      percentileUsed: s.percentileUsed,
      hitRate: s.hitRate,
      sampleSize: s.sampleSize,
      min: s.min,
      max: s.max,
      deltaFromOld: old == null ? null : s.threshold - old
    };
  }
  return { featureName, direction, percentile: percentileUsed, minSamples, excludeZeros, byDirection };
}

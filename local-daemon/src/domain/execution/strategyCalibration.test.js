// FILE: local-daemon/src/domain/execution/strategyCalibration.test.js
//
// R4 AUTO-CALIBRATE — pure percentile/threshold helpers (spec §4).
// Offline-only module: NOT wired into the runtime phase; run against feature
// dumps (trade_logs_rows.csv + future exports) to re-derive per-direction
// thresholds monthly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePercentiles,
  suggestThreshold,
  suggestThresholdByDirection,
  calibrateFeatureSet
} from './strategyCalibration.js';

const close = (actual, expected, eps = 1e-9) => Math.abs(actual - expected) < eps;

// Monotonic piecewise-linear fixture: exact values at anchor indices, linear
// between anchors. Keeps percentile expectations exact and reproducible.
function fillRamp(n, anchors) {
  const out = new Array(n);
  const pts = [...anchors].sort((a, b) => a[0] - b[0]);
  for (let k = 0; k < pts.length - 1; k++) {
    const [i0, v0] = pts[k];
    const [i1, v1] = pts[k + 1];
    const span = i1 - i0;
    for (let i = i0; i <= i1; i++) {
      out[i] = v0 + ((i - i0) / span) * (v1 - v0);
    }
  }
  return out;
}

// cvd_trend-shaped fixture (spec §1.1): 168 zeros + 80 nonzero; nonzero
// anchored so its exact median is -2.199 (nonzero p50 from CSV percentile table).
const ZERO_SKEW = [
  ...Array(168).fill(0),
  ...fillRamp(80, [[0, -5.9049], [39, -2.2], [40, -2.198], [79, 2.6092]])
];

// cvdD SHORT-shaped fixture: n=147, p90 anchored at 3.4295 (spec SHORT p90).
const SHORT_FIXTURE = fillRamp(147, [[0, -0.2370], [131, 3.4255], [132, 3.4355], [146, 5.9049]]);

// cvdD LONG-shaped fixture: 76 zeros + 25 nonzero; nonzero p10 anchored at -1.25.
const LONG_FIXTURE = [
  ...Array(76).fill(0),
  ...fillRamp(25, [[0, -3.2585], [2, -1.29], [3, -1.19], [24, 2.6092]])
];

test('computePercentiles: empty array => null', () => {
  assert.equal(computePercentiles([]), null);
});

test('computePercentiles: 1..100 => exact linear-interp percentiles', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  const result = computePercentiles(values);
  assert.equal(result.sampleSize, 100);
  // epsilon asserts: interpolated values like 90.1 are not binary-exact in JS
  assert.ok(close(result.p10, 10.9), `p10 ${result.p10}`);
  assert.ok(close(result.p25, 25.75), `p25 ${result.p25}`);
  assert.ok(close(result.p50, 50.5), `p50 ${result.p50}`);
  assert.ok(close(result.p75, 75.25), `p75 ${result.p75}`);
  assert.ok(close(result.p90, 90.1), `p90 ${result.p90}`);
  assert.ok(close(result.p95, 95.05), `p95 ${result.p95}`);
});

test('computePercentiles: zero-skew raw => p50 = 0 (67.7% zeros dominate)', () => {
  const result = computePercentiles(ZERO_SKEW);
  assert.equal(result.sampleSize, 248);
  assert.equal(result.p50, 0);
  assert.equal(result.p90, 0);
});

test('computePercentiles: excludeZeros removes zeros => nonzero p50 = -2.199', () => {
  const result = computePercentiles(ZERO_SKEW, { excludeZeros: true });
  assert.equal(result.sampleSize, 80);
  assert.ok(close(result.p50, -2.199), `expected ~-2.199, got ${result.p50}`);
});

test('computePercentiles: single value => every percentile equals the value', () => {
  const result = computePercentiles([42]);
  assert.equal(result.sampleSize, 1);
  assert.equal(result.p10, 42);
  assert.equal(result.p50, 42);
  assert.equal(result.p95, 42);
});

test('computePercentiles: all-equal values => every percentile equals the value', () => {
  const result = computePercentiles([5, 5, 5]);
  assert.equal(result.sampleSize, 3);
  assert.equal(result.p10, 5);
  assert.equal(result.p50, 5);
  assert.equal(result.p95, 5);
});

test('computePercentiles: NaN / null / undefined / empty string filtered out', () => {
  const result = computePercentiles([1, NaN, null, '', undefined, 2]);
  assert.equal(result.sampleSize, 2);
  assert.equal(result.p50, 1.5);
});

test('suggestThreshold: gte p90 on SHORT fixture => threshold 3.4295, hitRate ~10%', () => {
  const result = suggestThreshold(SHORT_FIXTURE, { direction: 'gte', percentile: 90 });
  assert.ok(close(result.threshold, 3.4295), `expected ~3.4295, got ${result.threshold}`);
  assert.equal(result.percentileUsed, 90);
  assert.equal(result.sampleSize, 147);
  assert.equal(result.min, -0.2370);
  assert.equal(result.max, 5.9049);
  assert.equal(result.hitRate, 15 / 147); // values >= 3.4295: indices 132..146
});

test('suggestThreshold: lte p10 with excludeZeros on LONG fixture => -1.25', () => {
  const result = suggestThreshold(LONG_FIXTURE, {
    direction: 'lte',
    percentile: 10,
    excludeZeros: true
  });
  assert.ok(close(result.threshold, -1.25), `expected ~-1.25, got ${result.threshold}`);
  assert.equal(result.sampleSize, 25); // zeros dropped before percentile
  assert.equal(result.hitRate, 3 / 25); // values <= -1.25: indices 0..2
});

test('suggestThreshold: percentile 0.9 normalised to 90 (same result)', () => {
  const a = suggestThreshold(SHORT_FIXTURE, { direction: 'gte', percentile: 90 });
  const b = suggestThreshold(SHORT_FIXTURE, { direction: 'gte', percentile: 0.9 });
  assert.equal(b.percentileUsed, 90);
  assert.equal(b.threshold, a.threshold);
});

test('suggestThreshold: sampleSize below minSamples => null', () => {
  assert.equal(
    suggestThreshold(SHORT_FIXTURE, { direction: 'gte', percentile: 90, minSamples: 200 }),
    null
  );
});

test('suggestThreshold: empty values => null', () => {
  assert.equal(suggestThreshold([], { direction: 'gte', percentile: 90 }), null);
});

test('suggestThreshold: all zeros with excludeZeros => null (empty after filter)', () => {
  assert.equal(
    suggestThreshold([0, 0, 0, 0], { direction: 'gte', percentile: 90, excludeZeros: true }),
    null
  );
});

test('suggestThresholdByDirection: per-direction thresholds differ (asymmetric sample)', () => {
  const result = suggestThresholdByDirection(
    { LONG: LONG_FIXTURE, SHORT: SHORT_FIXTURE },
    { direction: 'gte', percentile: 90 }
  );
  assert.ok(result.LONG, 'LONG present');
  assert.ok(result.SHORT, 'SHORT present');
  assert.notEqual(result.LONG.sampleSize, result.SHORT.sampleSize);
  assert.ok(result.SHORT.threshold > result.LONG.threshold);
});

test('suggestThresholdByDirection: empty input => empty object', () => {
  assert.deepEqual(suggestThresholdByDirection({}), {});
});

test('calibrateFeatureSet: reports feature, per-direction delta from old threshold', () => {
  const report = calibrateFeatureSet('CVD_STRUCTURE_DIVERGENCE', {
    LONG: LONG_FIXTURE,
    SHORT: SHORT_FIXTURE
  }, {
    direction: 'gte',
    percentile: 90,
    oldThresholds: { LONG: 10, SHORT: 10 }
  });
  assert.equal(report.featureName, 'CVD_STRUCTURE_DIVERGENCE');
  assert.ok(report.byDirection.LONG, 'LONG calibrated');
  assert.ok(report.byDirection.SHORT, 'SHORT calibrated');
  assert.equal(report.byDirection.SHORT.deltaFromOld, report.byDirection.SHORT.threshold - 10);
});

test('calibrateFeatureSet: direction under minSamples => null entry', () => {
  const report = calibrateFeatureSet('X', { LONG: [1, 2, 3], SHORT: SHORT_FIXTURE }, {
    direction: 'gte',
    percentile: 90,
    minSamples: 20
  });
  assert.equal(report.byDirection.LONG, null);
  assert.ok(report.byDirection.SHORT);
});

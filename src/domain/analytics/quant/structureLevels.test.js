import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findSwingHighs,
  findSwingLows,
  findNearestResistance,
  findNearestSupport
} from './structureLevels.js';
import QuantMath from '../QuantMath.js';

// F-E3 (2026-08-12): nearest swing-level lookup for TP/MSB payloads.
// Fractal detection is a verbatim copy of indicators.js:338-351 â€” the parity
// test below proves both produce the same swing list on the same fixture.

// Deterministic fixture: baseline 105/95 with planted 5-bar fractals.
// Non-planted spikes (108/88) are below/above the baseline so they can never
// become fractals (a 5-bar fractal only compares 2 neighbors each side).
const buildFixture = () => {
  const len = 60;
  const highs = Array(len).fill(105);
  const lows = Array(len).fill(95);
  const closes = Array(len).fill(100);
  highs[10] = 110; highs[20] = 115; highs[30] = 104;
  highs[40] = 120; highs[50] = 118;
  lows[15] = 90; lows[25] = 85; lows[35] = 96; lows[45] = 80;
  return { highs, lows, closes };
};

test('F-E3 parity: swing list matches indicators.detectMarketStructure on the same fixture', () => {
  const { highs, lows, closes } = buildFixture();
  const msb = QuantMath.detectMarketStructure(highs, lows, closes);
  assert.deepEqual(findSwingHighs(highs).at(-1), msb.lastSH);
  assert.deepEqual(findSwingLows(lows).at(-1), msb.lastSL);
  // both last swings are present in the full lists
  assert.ok(findSwingHighs(highs).some(s => s.price === 118 && s.index === 50));
  assert.ok(findSwingLows(lows).some(s => s.price === 80 && s.index === 45));
});

test('F-E3 findNearestResistance returns the closest swing high above entry', () => {
  const { highs, closes } = buildFixture();
  // full-window search (lookback 60 covers every planted fractal)
  const result = findNearestResistance(highs, closes, 105, { lookback: 60, atr: 2 });
  assert.deepEqual(result, { price: 110, index: 10, distAtr: 2.5 });
  const higher = findNearestResistance(highs, closes, 112, { lookback: 60, atr: 2 });
  assert.deepEqual(higher, { price: 115, index: 20, distAtr: 1.5 });
  // default lookback 40 restricts the window to the last 40 bars
  const defaultResult = findNearestResistance(highs, closes, 105, { atr: 2 });
  assert.deepEqual(defaultResult, { price: 115, index: 20, distAtr: 5 });
});

test('F-E3 findNearestSupport returns the closest swing low below entry', () => {
  const { lows, closes } = buildFixture();
  const result = findNearestSupport(lows, closes, 105, { lookback: 60, atr: 2 });
  assert.deepEqual(result, { price: 90, index: 15, distAtr: 7.5 });
  const lower = findNearestSupport(lows, closes, 87, { lookback: 60, atr: 2 });
  assert.deepEqual(lower, { price: 85, index: 25, distAtr: 1 });
});

test('F-E3 returns null when no swing level exists on the requested side', () => {
  const { highs, lows, closes } = buildFixture();
  assert.equal(findNearestResistance(highs, closes, 130), null);
  assert.equal(findNearestSupport(lows, closes, 70), null);
});

test('F-E3 lookback limits the swing window (nearest within the last N bars)', () => {
  const { highs, lows, closes } = buildFixture();
  // lookback 15 -> only swings at index >= 45 count: 118 at i=50
  const resistance = findNearestResistance(highs, closes, 105, { lookback: 15 });
  assert.deepEqual(resistance, { price: 118, index: 50, distAtr: null });
  const support = findNearestSupport(lows, closes, 105, { lookback: 15 });
  assert.deepEqual(support, { price: 80, index: 45, distAtr: null });
});

test('F-E3 distAtr is null when ATR is missing or non-positive', () => {
  const { highs, lows, closes } = buildFixture();
  const noAtr = findNearestResistance(highs, closes, 105, { lookback: 60 });
  assert.equal(noAtr.price, 110);
  assert.equal(noAtr.distAtr, null);
  const zeroAtr = findNearestResistance(highs, closes, 105, { lookback: 60, atr: 0 });
  assert.equal(zeroAtr.distAtr, null);
  const negAtr = findNearestSupport(lows, closes, 105, { lookback: 60, atr: -3 });
  assert.equal(negAtr.distAtr, null);
});

test('F-E3 tolerates empty/short input without throwing', () => {
  assert.doesNotThrow(() => findNearestResistance([], [], 100));
  assert.equal(findNearestResistance([], [], 100), null);
  assert.doesNotThrow(() => findNearestSupport([], [], 100));
  assert.equal(findNearestSupport([], [], 100), null);
  assert.doesNotThrow(() => findSwingHighs([1, 2, 3]));
  assert.deepEqual(findSwingHighs([1, 2, 3]), []);
  assert.doesNotThrow(() => findNearestResistance(null, null, 100));
  assert.equal(findNearestResistance(null, null, 100), null);
});

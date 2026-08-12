import test from 'node:test';
import assert from 'node:assert/strict';

import { computeStructureStop } from './structureStopPolicy.js';

// F-E2a (2026-08-12): SL structure SHADOW policy — computes what the stop
// WOULD be if the last swing level (lastSL/lastSH) were used instead of the
// ATR multiple. Pure, fail-open: never throws, always returns a stop decision.

const approx = (actual, expected, epsilon = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${expected} +/- ${epsilon}, got ${actual}`
  );
};

const longBase = overrides => ({
  direction: 'LONG',
  entry: 100,
  atr: 2,
  slDistanceAtr: 1.5,
  lastSL: { index: 50, price: 98.5 },
  lastSH: null,
  swingAge: 5,
  adx: 25,
  msbRegime: 'Uptrend',
  msbState: 'Bullish_MSB',
  tickSize: 0.01,
  ...overrides
});

const shortBase = overrides => ({
  direction: 'SHORT',
  entry: 100,
  atr: 2,
  slDistanceAtr: 1.5,
  lastSL: null,
  lastSH: { index: 50, price: 101.5 },
  swingAge: 5,
  adx: 25,
  msbRegime: 'Downtrend',
  msbState: 'Bearish_MSB',
  tickSize: 0.01,
  ...overrides
});

test('F-E2a LONG: valid structure level tighter than ATR -> STRUCTURE stop', () => {
  const result = computeStructureStop(longBase());
  // buffer = max(0.05*2, 2*0.01) = 0.10; slStruct = 98.5 - 0.10 = 98.4
  // slAtr = 100 - 1.5*2 = 97; price-space max -> 98.4 (tighter)
  assert.equal(result.applied, 'STRUCTURE');
  assert.equal(result.reason, 'OK');
  assert.equal(result.momentumSource, 'MOMENTUM');
  approx(result.stopPrice, 98.4);
  approx(result.slAtr, 97);
  approx(result.slStruct, 98.4);
  approx(result.bufferUsed, 0.1);
  approx(result.distance, 1.6);
});

test('F-E2a SHORT: mirror uses lastSH above entry, price-space min', () => {
  const result = computeStructureStop(shortBase());
  // slStruct = 101.5 + 0.10 = 101.6; slAtr = 103; min -> 101.6 (tighter)
  assert.equal(result.applied, 'STRUCTURE');
  assert.equal(result.reason, 'OK');
  approx(result.stopPrice, 101.6);
  approx(result.distance, 1.6);
});

test('F-E2a SHORT: crossed level (lastSH below entry) -> ATR LEVEL_CROSSED', () => {
  const result = computeStructureStop(shortBase({ lastSH: { index: 50, price: 99 } }));
  assert.equal(result.applied, 'ATR');
  assert.equal(result.reason, 'LEVEL_CROSSED');
  approx(result.stopPrice, 103);
});

test('F-E2a NO_LEVEL: missing lastSL/lastSH -> ATR NO_LEVEL', () => {
  const noLevel = computeStructureStop(longBase({ lastSL: null }));
  assert.equal(noLevel.applied, 'ATR');
  assert.equal(noLevel.reason, 'NO_LEVEL');
  approx(noLevel.stopPrice, 97);
  const noLevelShort = computeStructureStop(shortBase({ lastSH: undefined }));
  assert.equal(noLevelShort.reason, 'NO_LEVEL');
});

test('F-E2a LEVEL_CROSSED: LONG level at/above entry -> ATR LEVEL_CROSSED', () => {
  const crossed = computeStructureStop(longBase({ lastSL: { index: 50, price: 100 } }));
  assert.equal(crossed.applied, 'ATR');
  assert.equal(crossed.reason, 'LEVEL_CROSSED');
  approx(crossed.stopPrice, 97);
  const above = computeStructureStop(longBase({ lastSL: { index: 50, price: 101 } }));
  assert.equal(above.reason, 'LEVEL_CROSSED');
});

test('F-E2a STALE: swing older than maxAgeBars -> ATR STALE', () => {
  const stale = computeStructureStop(longBase({ swingAge: 21 }));
  assert.equal(stale.applied, 'ATR');
  assert.equal(stale.reason, 'STALE');
  approx(stale.stopPrice, 97);
  // boundary: exactly maxAgeBars is still fresh
  const fresh = computeStructureStop(longBase({ swingAge: 20 }));
  assert.equal(fresh.applied, 'STRUCTURE');
});

test('F-E2a TOO_TIGHT: structure stop closer than minAtrFloor*ATR -> ATR TOO_TIGHT', () => {
  const result = computeStructureStop(longBase({ lastSL: { index: 50, price: 99.9 } }));
  // slStruct = 99.8, dist = 0.2 < minAtrFloor*atr = 1.0
  assert.equal(result.applied, 'ATR');
  assert.equal(result.reason, 'TOO_TIGHT');
  approx(result.stopPrice, 97);
});

test('F-E2a NO_MOMENTUM: low ADX and no aligned regime -> ATR NO_MOMENTUM', () => {
  const result = computeStructureStop(longBase({
    adx: 10,
    msbRegime: 'Range',
    msbState: 'None'
  }));
  assert.equal(result.applied, 'ATR');
  assert.equal(result.reason, 'NO_MOMENTUM');
  approx(result.stopPrice, 97);
});

test('F-E2a REGIME momentum: low ADX but aligned regime passes the momentum gate', () => {
  // LONG: regime Uptrend counts as aligned even with weak ADX
  const viaRegime = computeStructureStop(longBase({ adx: 10, msbRegime: 'Uptrend', msbState: 'None' }));
  assert.equal(viaRegime.applied, 'STRUCTURE');
  assert.equal(viaRegime.momentumSource, 'REGIME');
  // SHORT: Bearish_MSB counts as aligned; Sideways does not
  const viaMsb = computeStructureStop(shortBase({ adx: 10, msbRegime: 'Range', msbState: 'Bearish_MSB' }));
  assert.equal(viaMsb.applied, 'STRUCTURE');
  assert.equal(viaMsb.momentumSource, 'REGIME');
  const sideways = computeStructureStop(longBase({ adx: 10, msbRegime: 'Sideways', msbState: 'None' }));
  assert.equal(sideways.applied, 'ATR');
  assert.equal(sideways.reason, 'NO_MOMENTUM');
});

test('F-E2a INVALID: missing required fields -> ATR INVALID without throwing', () => {
  assert.doesNotThrow(() => computeStructureStop({}));
  const empty = computeStructureStop({});
  assert.equal(empty.applied, 'ATR');
  assert.equal(empty.reason, 'INVALID');

  const badDirection = computeStructureStop(longBase({ direction: 'FLAT' }));
  assert.equal(badDirection.reason, 'INVALID');

  const zeroAtr = computeStructureStop(longBase({ atr: 0 }));
  assert.equal(zeroAtr.reason, 'INVALID');

  const negativeEntry = computeStructureStop(longBase({ entry: -5 }));
  assert.equal(negativeEntry.reason, 'INVALID');
});

test('F-E2a buffer uses max(0.05*ATR, 2*tickSize)', () => {
  // default: 0.05*2 = 0.1 beats 2*0.01 = 0.02
  const smallTick = computeStructureStop(longBase());
  approx(smallTick.bufferUsed, 0.1);
  // coarse tick: 2*1 = 2.0 beats 0.1
  const coarseTick = computeStructureStop(longBase({ tickSize: 1 }));
  approx(coarseTick.bufferUsed, 2);
  approx(coarseTick.slStruct, 98.5 - 2);
  // no tickSize -> falls back to ATR ratio only
  const noTick = computeStructureStop(longBase({ tickSize: undefined }));
  approx(noTick.bufferUsed, 0.1);
});

test('F-E2a invariant: final stop distance never exceeds slDistanceAtr*ATR', () => {
  const cases = [
    longBase(),
    longBase({ lastSL: { index: 50, price: 98.0 } }),
    longBase({ lastSL: { index: 50, price: 99.5 } }),
    longBase({ lastSL: { index: 50, price: 98.5 }, tickSize: 0.5 }),
    shortBase(),
    shortBase({ lastSH: { index: 50, price: 102.0 } }),
    shortBase({ lastSH: { index: 50, price: 100.8 }, tickSize: 0.25 }),
    longBase({ adx: 10, msbRegime: 'Uptrend' }),
    longBase({ lastSL: { index: 50, price: 99.9 } })
  ];
  for (const input of cases) {
    const result = computeStructureStop(input);
    assert.ok(
      result.distance <= input.slDistanceAtr * input.atr + 1e-9,
      `distance ${result.distance} exceeds slDistanceAtr*ATR for ${JSON.stringify(input)}`
    );
    assert.ok(result.distance > 0);
    // the stop must be on the correct side of the entry
    if (input.direction === 'LONG') {
      assert.ok(result.stopPrice < input.entry, 'LONG stop must sit below entry');
    } else {
      assert.ok(result.stopPrice > input.entry, 'SHORT stop must sit above entry');
    }
  }
});

test('F-E2a LONG: structure level NOT tighter than ATR falls back to ATR stop', () => {
  const result = computeStructureStop(longBase({ lastSL: { index: 50, price: 96.5 } }));
  // slStruct = 96.4 < slAtr = 97 -> ATR stop wins (tighter)
  assert.equal(result.applied, 'ATR');
  assert.equal(result.reason, 'OK');
  approx(result.stopPrice, 97);
});

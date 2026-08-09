// FILE: local-daemon/src/application/strategyHealth/strategyWatchdog.test.js
//
// R3 WATCHDOG — pure stale-strategy detection (spec §3).
// The daemonScheduler owns the 5-min interval and the in-memory fire-state
// Map; this module only classifies + formats, so it is fully deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findStaleStrategies,
  logStaleSummary,
  SCANNER_CYCLE_MS
} from './strategyWatchdog.js';

const now = 1_000_000_000_000;
const cycle = SCANNER_CYCLE_MS; // 60_000

const strategy = (strategyId, lastFiredAt) => ({ strategyId, lastFiredAt });

test('findStaleStrategies: lastFiredAt null => NEVER_FIRED', () => {
  const result = findStaleStrategies({
    strategies: [strategy('ALPHA', null)],
    now
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'NEVER_FIRED');
  assert.equal(result[0].staleCycles, Infinity);
  assert.equal(result[0].lastFiredAt, null);
});

test('findStaleStrategies: lastFiredAt 0 => NEVER_FIRED (guard)', () => {
  const result = findStaleStrategies({
    strategies: [strategy('ALPHA', 0)],
    now
  });
  assert.equal(result[0].status, 'NEVER_FIRED');
});

test('findStaleStrategies: 721 cycles since last fire => STALE (>= 720)', () => {
  const result = findStaleStrategies({
    strategies: [strategy('ALPHA', now - 721 * cycle)],
    now,
    staleAfterCycles: 720
  });
  assert.equal(result[0].status, 'STALE');
  assert.equal(result[0].staleCycles, 721);
});

test('findStaleStrategies: 719 cycles since last fire => ACTIVE (< 720)', () => {
  const result = findStaleStrategies({
    strategies: [strategy('ALPHA', now - 719 * cycle)],
    now,
    staleAfterCycles: 720
  });
  assert.equal(result.length, 0);
});

test('findStaleStrategies: staleAfterCycles 0 => every fired strategy STALE', () => {
  const result = findStaleStrategies({
    strategies: [
      strategy('ALPHA', now - 1),
      strategy('BETA', now - cycle),
      strategy('GAMMA', null)
    ],
    now,
    staleAfterCycles: 0
  });
  assert.deepEqual(result.map(s => [s.strategyId, s.status]), [
    ['ALPHA', 'STALE'],
    ['BETA', 'STALE'],
    ['GAMMA', 'NEVER_FIRED']
  ]);
});

test('findStaleStrategies: future lastFiredAt (clock skew) => ACTIVE', () => {
  const result = findStaleStrategies({
    strategies: [strategy('ALPHA', now + 60_000)],
    now
  });
  assert.equal(result.length, 0);
});

test('findStaleStrategies: boundary 720 cycles exactly => STALE', () => {
  const result = findStaleStrategies({
    strategies: [strategy('ALPHA', now - 720 * cycle)],
    now,
    staleAfterCycles: 720
  });
  assert.equal(result[0].status, 'STALE');
  assert.equal(result[0].staleCycles, 720);
});

test('findStaleStrategies: empty strategies => empty list', () => {
  assert.deepEqual(findStaleStrategies({ strategies: [], now }), []);
});

test('findStaleStrategies: mixed list filters ACTIVE out, keeps order', () => {
  const result = findStaleStrategies({
    strategies: [
      strategy('ALPHA', now - 1000),        // ACTIVE
      strategy('BETA', null),               // NEVER_FIRED
      strategy('GAMMA', now - 721 * cycle), // STALE
      strategy('DELTA', now - 100 * cycle)  // ACTIVE
    ],
    now
  });
  assert.deepEqual(result.map(s => [s.strategyId, s.status]), [
    ['BETA', 'NEVER_FIRED'],
    ['GAMMA', 'STALE']
  ]);
});

test('logStaleSummary: formats ids with status', () => {
  const stale = [
    { strategyId: 'CVD_STRUCTURE_DIVERGENCE', status: 'NEVER_FIRED' },
    { strategyId: 'PASSIVE_ABSORPTION_REVERSAL', status: 'STALE' }
  ];
  assert.equal(
    logStaleSummary(stale),
    '[STRATEGY STALE] CVD_STRUCTURE_DIVERGENCE (NEVER_FIRED), PASSIVE_ABSORPTION_REVERSAL (STALE)'
  );
});

test('logStaleSummary: empty list => none', () => {
  assert.equal(logStaleSummary([]), '[STRATEGY STALE] none');
  assert.equal(logStaleSummary(), '[STRATEGY STALE] none');
});

test('logStaleSummary: non-array input => none (defensive)', () => {
  assert.equal(logStaleSummary(null), '[STRATEGY STALE] none');
  assert.equal(logStaleSummary(undefined), '[STRATEGY STALE] none');
});

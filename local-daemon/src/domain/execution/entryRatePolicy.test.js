// FILE: local-daemon/src/domain/execution/entryRatePolicy.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBatchCooldownActive,
  capTargetsByOpenPositions
} from './entryRatePolicy.js';

const setup = (symbol, score) => ({ symbol, score });

test('isBatchCooldownActive: lastEntryBatchAt = 0 (never entered) => false', () => {
  assert.equal(isBatchCooldownActive(0, 1_000_000, 60_000), false);
});

test('isBatchCooldownActive: batch younger than interval => true', () => {
  assert.equal(isBatchCooldownActive(1_000_000, 1_030_000, 60_000), true);
});

test('isBatchCooldownActive: batch exactly at interval boundary => false', () => {
  assert.equal(isBatchCooldownActive(1_000_000, 1_060_000, 60_000), false);
});

test('isBatchCooldownActive: batch older than interval => false', () => {
  assert.equal(isBatchCooldownActive(1_000_000, 1_200_000, 60_000), false);
});

test('isBatchCooldownActive: negative now delta (clock skew) => true (guard)', () => {
  assert.equal(isBatchCooldownActive(1_000_000, 900_000, 60_000), true);
});

test('capTargetsByOpenPositions: more setups than cap => sliced to cap', () => {
  const setups = [setup('A', 90), setup('B', 80), setup('C', 70), setup('D', 60), setup('E', 50), setup('F', 40)];
  const result = capTargetsByOpenPositions(setups, 10, 5);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map(s => s.symbol), ['A', 'B', 'C', 'D', 'E']);
});

test('capTargetsByOpenPositions: free slots lower than maxOpenPositions => sliced to slots', () => {
  const setups = [setup('A', 90), setup('B', 80)];
  const result = capTargetsByOpenPositions(setups, 1, 5);
  assert.equal(result.length, 1);
  assert.equal(result[0].symbol, 'A');
});

test('capTargetsByOpenPositions: fewer setups than cap => all returned', () => {
  const setups = [setup('A', 90), setup('B', 80)];
  const result = capTargetsByOpenPositions(setups, 10, 5);
  assert.equal(result.length, 2);
});

test('capTargetsByOpenPositions: zero/negative free slots => empty', () => {
  assert.equal(capTargetsByOpenPositions([setup('A', 90)], 0, 5).length, 0);
  assert.equal(capTargetsByOpenPositions([setup('A', 90)], -3, 5).length, 0);
});

test('capTargetsByOpenPositions: non-array input => empty (defensive)', () => {
  assert.deepEqual(capTargetsByOpenPositions(null, 10, 5), []);
  assert.deepEqual(capTargetsByOpenPositions(undefined, 10, 5), []);
});

test('capTargetsByOpenPositions: fractional slots floored', () => {
  const setups = [setup('A', 90), setup('B', 80)];
  assert.equal(capTargetsByOpenPositions(setups, 2.9, 5).length, 2);
});

test('capTargetsByOpenPositions: original list not mutated', () => {
  const setups = [setup('A', 90), setup('B', 80), setup('C', 70)];
  capTargetsByOpenPositions(setups, 10, 2);
  assert.equal(setups.length, 3);
});

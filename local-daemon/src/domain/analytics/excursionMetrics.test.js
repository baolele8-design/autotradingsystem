import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateDirectionalExcursions } from './excursionMetrics.js';

const candles = [
  [0, '100', '103', '98', '101'],
  [1, '101', '105', '99', '104']
];

test('calculates long excursion values and first extrema indexes', () => {
  assert.deepEqual(
    calculateDirectionalExcursions({
      anchorPrice: 100,
      candles,
      direction: 'LONG',
      quantity: 2
    }),
    {
      favorableCandles: 2,
      favorableUsd: 10,
      adverseCandles: 1,
      adverseUsd: -4
    }
  );
});

test('mirrors excursion values for a short trade', () => {
  assert.deepEqual(
    calculateDirectionalExcursions({
      anchorPrice: 100,
      candles,
      direction: 'SHORT',
      quantity: 2
    }),
    {
      favorableCandles: 1,
      favorableUsd: 4,
      adverseCandles: 2,
      adverseUsd: -10
    }
  );
});

test('fails closed for invalid geometry', () => {
  assert.equal(
    calculateDirectionalExcursions({
      anchorPrice: 0,
      candles,
      direction: 'LONG',
      quantity: 2
    }),
    null
  );
});

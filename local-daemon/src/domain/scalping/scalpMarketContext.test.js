import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIN_CONTEXT_CANDLES,
  buildScalpMarketContext,
  calculateOrderBookImbalance,
  mergeCandle,
  normalizeRestKline,
  normalizeStreamKline
} from './scalpMarketContext.js';

function candles(count, {
  intervalMs = 300_000,
  now = Date.now()
} = {}) {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index / 8) * 0.8;
    const close = 100 + index * 0.02 + wave;
    const openTime = now - (count - index) * intervalMs;
    return {
      openTime,
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1_000 + index * 2,
      quoteVolume: close * (1_000 + index * 2),
      takerBuyVolume: (1_000 + index * 2) * (0.48 + index % 5 * 0.01),
      takerBuyQuoteVolume: close * 500,
      closeTime: openTime + intervalMs - 1,
      isClosed: true
    };
  });
}

test('normalizes real REST and stream taker-buy fields', () => {
  const rest = normalizeRestKline([
    1, '100', '102', '99', '101', '10', 2,
    '1010', 42, '6', '606'
  ], 3);
  assert.equal(rest.takerBuyVolume, 6);
  assert.equal(rest.quoteVolume, 1010);
  assert.equal(rest.isClosed, true);

  const stream = normalizeStreamKline({
    k: {
      t: 1, o: '100', h: '102', l: '99', c: '101',
      v: '10', T: 2, q: '1010', n: 42, V: '6',
      Q: '606', x: true
    }
  });
  assert.equal(stream.takerBuyVolume, 6);
  assert.equal(stream.isClosed, true);
});

test('keeps each candle ordered and replaces updates by open time', () => {
  const target = [];
  mergeCandle(target, { openTime: 2, close: 2 });
  mergeCandle(target, { openTime: 1, close: 1 });
  mergeCandle(target, { openTime: 2, close: 3 });
  assert.deepEqual(
    target.map(item => [item.openTime, item.close]),
    [[1, 1], [2, 3]]
  );
});

test('calculates quote-notional order-book imbalance', () => {
  const imbalance = calculateOrderBookImbalance(
    [['100', '2']],
    [['101', '1']]
  );
  assert.ok(Math.abs(imbalance - 200 / 301) < 1e-12);
  assert.equal(calculateOrderBookImbalance([], []), null);
});

test('fails closed without enough candles or fresh depth', () => {
  const context = buildScalpMarketContext({
    candles: candles(50),
    depthSnapshot: null,
    intervalMs: 300_000
  });
  assert.equal(context.ready, false);
  assert.ok(context.reasons.some(
    reason => reason.startsWith('CANDLE_HISTORY_')
  ));
  assert.ok(context.reasons.includes('ORDER_BOOK_STALE_OR_MISSING'));
});

test('builds dimensionally valid ranks and real microstructure context', () => {
  const now = Date.now();
  const context = buildScalpMarketContext({
    candles: candles(MIN_CONTEXT_CANDLES + 20, { now }),
    depthSnapshot: {
      bids: [['100', '10'], ['99.9', '8']],
      asks: [['100.1', '7'], ['100.2', '6']],
      receivedAt: now
    },
    intervalMs: 300_000,
    now
  });

  assert.equal(context.ready, true);
  assert.ok(context.atrRank >= 0 && context.atrRank <= 100);
  assert.ok(context.bbwRank >= 0 && context.bbwRank <= 100);
  assert.ok(context.obi > 0 && context.obi < 1);
  assert.ok(Number.isFinite(context.cvdTrend));
  assert.ok(Number.isFinite(context.bbwSlope));
  assert.notEqual(context.l1, undefined);
  assert.notEqual(context.l2, undefined);
});

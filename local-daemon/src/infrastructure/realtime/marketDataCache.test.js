import assert from 'node:assert/strict';
import test from 'node:test';

import { createMarketDataCache } from './marketDataCache.js';

test('bootstraps a kline series once and merges WebSocket candles', async () => {
  let restCalls = 0;
  const requestedStreams = [];
  const cache = createMarketDataCache({
    markPriceCache: new Map(),
    safeFetch: async () => {
      restCalls += 1;
      return [
        [1000, '1', '2', '0.5', '1.5', '10', 1999, '15', 2, '6', '9', '0'],
        [2000, '1.5', '3', '1', '2', '20', 2999, '40', 3, '12', '24', '0']
      ];
    }
  });
  cache.setKlineSubscriptionHandler((symbol, interval) => {
    requestedStreams.push(`${symbol}:${interval}`);
  });

  const first = await cache.getKlines('BTCUSDT', '5m', 250);
  const second = await cache.getKlines('BTCUSDT', '5m', 250);
  cache.updateKline({
    e: 'kline',
    s: 'BTCUSDT',
    k: {
      B: '0',
      Q: '30',
      T: 2999,
      V: '15',
      c: '2.5',
      h: '3',
      i: '5m',
      l: '1',
      n: 4,
      o: '1.5',
      q: '50',
      t: 2000,
      v: '22'
    }
  });
  const merged = await cache.getKlines('BTCUSDT', '5m', 250);

  assert.equal(restCalls, 1);
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal(merged.length, 2);
  assert.equal(merged.at(-1)[4], '2.5');
  assert.ok(requestedStreams.every(stream => stream === 'BTCUSDT:5m'));
});

test('normalizes all-market snapshots for existing scanner contracts', () => {
  const cache = createMarketDataCache({
    markPriceCache: new Map(),
    safeFetch: async () => null
  });

  for (let index = 0; index < 10; index += 1) {
    const symbol = `COIN${index}USDT`;
    cache.updateTicker24h({
      C: 2,
      E: 2,
      F: 1,
      L: 2,
      O: 1,
      P: '1.2',
      Q: '1',
      c: '100',
      e: '24hrTicker',
      h: '110',
      l: '90',
      n: 2,
      o: '99',
      p: '1',
      q: '1000000',
      s: symbol,
      v: '10000',
      w: '100'
    });
  }

  const tickers = cache.getTicker24hAll();
  assert.equal(tickers.length, 10);
  assert.equal(tickers[0].priceChangePercent, '1.2');
  assert.equal(tickers[0].quoteVolume, '1000000');
});

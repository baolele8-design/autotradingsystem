import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getLiquidationCoverage,
  LIQUIDATION_WINDOW_MS,
  markLiquidationStreamConnected,
  markLiquidationStreamDisconnected,
  readLiquidationWindow,
  recordLiquidation
} from './liquidationWindow.js';

test('forced SELL counts as long liquidation and BUY as short liquidation', () => {
  const cache = new Map();
  const now = 1_000_000;

  recordLiquidation(
    cache,
    'btcusdt',
    {
      id: 'sell-1',
      notionalUsd: 125,
      side: 'SELL',
      timestamp: now
    },
    { now }
  );
  recordLiquidation(
    cache,
    'BTCUSDT',
    {
      id: 'buy-1',
      notionalUsd: 75,
      side: 'BUY',
      timestamp: now
    },
    { now }
  );

  const snapshot = readLiquidationWindow(
    cache,
    'btcusdt',
    { now }
  );
  assert.equal(snapshot.longs, 125);
  assert.equal(snapshot.shorts, 75);
  assert.equal(snapshot.eventCount, 2);
});

test('repeated liquidation snapshots are deduplicated by stable id', () => {
  const cache = new Map();
  const now = 2_000_000;
  const event = {
    id: 'same-force-order',
    notionalUsd: 500,
    side: 'SELL',
    timestamp: now
  };

  recordLiquidation(cache, 'ETHUSDT', event, { now });
  recordLiquidation(cache, 'ETHUSDT', event, { now: now + 1 });

  const snapshot = readLiquidationWindow(
    cache,
    'ETHUSDT',
    { now: now + 1 }
  );
  assert.equal(snapshot.eventCount, 1);
  assert.equal(snapshot.longs, 500);
});

test('read prunes expired events from the rolling 15m window', () => {
  const cache = new Map();
  const now = 10_000_000;

  recordLiquidation(
    cache,
    'SOLUSDT',
    {
      id: 'boundary',
      notionalUsd: 10,
      side: 'SELL',
      timestamp: now - LIQUIDATION_WINDOW_MS
    },
    { now }
  );
  recordLiquidation(
    cache,
    'SOLUSDT',
    {
      id: 'fresh',
      notionalUsd: 20,
      side: 'BUY',
      timestamp: now
    },
    { now }
  );

  const atBoundary = readLiquidationWindow(
    cache,
    'SOLUSDT',
    { now }
  );
  assert.equal(atBoundary.eventCount, 2);

  const afterBoundary = readLiquidationWindow(
    cache,
    'SOLUSDT',
    { now: now + 1 }
  );
  assert.equal(afterBoundary.eventCount, 1);
  assert.equal(afterBoundary.longs, 0);
  assert.equal(afterBoundary.shorts, 20);

  const empty = readLiquidationWindow(
    cache,
    'SOLUSDT',
    { now: now + LIQUIDATION_WINDOW_MS + 1 }
  );
  assert.equal(empty.eventCount, 0);
  assert.equal(cache.has('SOLUSDT'), false);
});

test('invalid events never enter the liquidation window', () => {
  const cache = new Map();
  assert.equal(
    recordLiquidation(cache, 'BNBUSDT', {
      notionalUsd: 0,
      side: 'SELL'
    }),
    null
  );
  assert.equal(
    recordLiquidation(cache, 'BNBUSDT', {
      notionalUsd: 100,
      side: 'UNKNOWN'
    }),
    null
  );
  assert.equal(cache.size, 0);
});

test('coverage warms up for a full window and exposes lower-bound metadata', () => {
  const cache = new Map();
  const connectedAt = 20_000_000;

  const initial = getLiquidationCoverage(cache, {
    now: connectedAt
  });
  assert.equal(initial.streamConnected, false);
  assert.equal(initial.coverageReady, false);

  markLiquidationStreamConnected(cache, { now: connectedAt });
  const warming = readLiquidationWindow(
    cache,
    'BTCUSDT',
    { now: connectedAt + LIQUIDATION_WINDOW_MS - 1 }
  );
  assert.equal(warming.streamConnected, true);
  assert.equal(warming.coverageReady, false);
  assert.equal(warming.warmupRemainingMs, 1);
  assert.equal(warming.observedLowerBound, true);
  assert.equal(
    warming.completeness,
    'observed_lower_bound'
  );
  assert.equal(
    warming.notionalUnit,
    'quote_asset_notional_usd_equivalent'
  );

  const ready = readLiquidationWindow(
    cache,
    'BTCUSDT',
    { now: connectedAt + LIQUIDATION_WINDOW_MS }
  );
  assert.equal(ready.coverageReady, true);
  assert.equal(ready.warmupRemainingMs, 0);
});

test('disconnect clears observations and reconnect restarts warm-up', () => {
  const cache = new Map();
  const connectedAt = 30_000_000;

  markLiquidationStreamConnected(cache, { now: connectedAt });
  recordLiquidation(
    cache,
    'ETHUSDT',
    {
      id: 'before-gap',
      notionalUsd: 500,
      side: 'SELL',
      timestamp: connectedAt + LIQUIDATION_WINDOW_MS
    },
    { now: connectedAt + LIQUIDATION_WINDOW_MS }
  );
  assert.equal(cache.size, 1);

  const disconnectedAt =
    connectedAt + LIQUIDATION_WINDOW_MS + 1;
  const disconnected = markLiquidationStreamDisconnected(
    cache,
    { now: disconnectedAt }
  );
  assert.equal(cache.size, 0);
  assert.equal(disconnected.streamConnected, false);
  assert.equal(disconnected.coverageReady, false);

  const reconnectedAt = disconnectedAt + 1_000;
  markLiquidationStreamConnected(cache, { now: reconnectedAt });
  const afterReconnect = readLiquidationWindow(
    cache,
    'ETHUSDT',
    { now: reconnectedAt + 1 }
  );
  assert.equal(afterReconnect.eventCount, 0);
  assert.equal(afterReconnect.coverageReady, false);
  assert.equal(afterReconnect.coverageMs, 1);
});

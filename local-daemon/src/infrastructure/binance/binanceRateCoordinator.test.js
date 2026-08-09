import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BINANCE_RATE_PRIORITY,
  createBinanceRateCoordinator,
  estimateBinanceRateCost
} from './binanceRateCoordinator.js';

test('reserves progressively larger budgets while preserving protection headroom', () => {
  let clock = 120_000;
  const coordinator = createBinanceRateCoordinator({ now: () => clock });

  assert.equal(coordinator.reserve({ requestWeight: 1_560 }).allowed, true);
  assert.equal(coordinator.reserve({ requestWeight: 1 }).allowed, false);
  assert.equal(coordinator.reserve({
    priority: BINANCE_RATE_PRIORITY.EXECUTION,
    requestWeight: 480
  }).allowed, true);
  assert.equal(coordinator.reserve({
    priority: BINANCE_RATE_PRIORITY.PROTECTION,
    requestWeight: 240
  }).allowed, true);
  assert.equal(coordinator.reserve({
    priority: BINANCE_RATE_PRIORITY.PROTECTION,
    requestWeight: 1
  }).allowed, false);

  clock += 60_000;
  assert.equal(coordinator.reserve({ requestWeight: 1 }).allowed, true);
});

test('pre-charge prevents a concurrent burst from overshooting its lane', async () => {
  const coordinator = createBinanceRateCoordinator({
    limits: {
      orderCount10s: 100,
      orderCount1m: 100,
      requestWeight1m: 100
    },
    now: () => 60_000
  });
  const results = await Promise.all(
    Array.from({ length: 100 }, async () =>
      coordinator.reserve({ requestWeight: 1 })
    )
  );

  assert.equal(results.filter(result => result.allowed).length, 65);
  assert.equal(coordinator.getState().used.requestWeight1m, 65);
  assert.equal(coordinator.getState().headroom.requestWeight1m, 35);
  assert.equal(coordinator.getState().utilization.requestWeight1m, 0.65);
});

test('mixed ten-thousand request burst stays below weight and order ceilings', async () => {
  const coordinator = createBinanceRateCoordinator({ now: () => 60_000 });
  const priorities = [
    BINANCE_RATE_PRIORITY.MARKET_DATA,
    BINANCE_RATE_PRIORITY.ACCOUNT,
    BINANCE_RATE_PRIORITY.EXECUTION,
    BINANCE_RATE_PRIORITY.PROTECTION
  ];
  const results = await Promise.all(
    Array.from({ length: 10_000 }, async (_value, index) => {
      const priority = priorities[index % priorities.length];
      return coordinator.reserve({
        orderCount: index % 4 >= 2 ? 1 : 0,
        priority,
        requestWeight: 1
      });
    })
  );
  const state = coordinator.getState();

  assert.ok(results.some(result => !result.allowed));
  assert.ok(state.used.requestWeight1m <= 2_280);
  assert.ok(state.used.orderCount10s <= 285);
  assert.ok(state.used.orderCount1m <= 1_140);
});

test('tracks request and order headers without reducing pre-charged usage', () => {
  const coordinator = createBinanceRateCoordinator({ now: () => 60_000 });
  coordinator.reserve({
    orderCount: 2,
    priority: BINANCE_RATE_PRIORITY.EXECUTION,
    requestWeight: 10
  });
  coordinator.observeResponse({
    headers: new Headers({
      'x-mbx-order-count-10s': '1',
      'x-mbx-order-count-1m': '4',
      'x-mbx-used-weight-1m': '8'
    }),
    status: 200
  });

  assert.deepEqual(coordinator.getState().used, {
    orderCount10s: 2,
    orderCount1m: 4,
    requestWeight1m: 10
  });
});

test('429 blocks every priority until Retry-After expires', () => {
  let clock = 60_000;
  const coordinator = createBinanceRateCoordinator({ now: () => clock });
  coordinator.observeResponse({
    headers: new Headers({ 'retry-after': '2' }),
    status: 429
  });

  assert.equal(coordinator.reserve({
    priority: BINANCE_RATE_PRIORITY.EXECUTION
  }).reason, 'BINANCE_BACKOFF_ACTIVE');
  clock += 2_000;
  assert.equal(coordinator.reserve({
    priority: BINANCE_RATE_PRIORITY.EXECUTION
  }).allowed, true);
});

test('shared-process cold start permits only one reconciliation probe', () => {
  let clock = 60_000;
  const coordinator = createBinanceRateCoordinator({
    now: () => clock,
    requireInitialObservation: true
  });

  assert.equal(coordinator.reserve({ requestWeight: 1 }).reason, 'RATE_STATE_WARMING');
  assert.equal(coordinator.reserve({
    priority: BINANCE_RATE_PRIORITY.RECONCILIATION,
    requestWeight: 1
  }).allowed, true);
  assert.equal(coordinator.reserve({
    priority: BINANCE_RATE_PRIORITY.RECONCILIATION,
    requestWeight: 1
  }).reason, 'RATE_STATE_WARMING');
  assert.equal(coordinator.getState().ready, false);

  coordinator.observeResponse({
    headers: new Headers({ 'x-mbx-used-weight-1m': '2000' }),
    status: 200
  });
  assert.equal(coordinator.getState().ready, true);
  assert.equal(coordinator.getState().used.requestWeight1m, 2_000);
  assert.equal(coordinator.reserve({ requestWeight: 1 }).allowed, false);

  clock += 60_000;
  assert.equal(coordinator.reserve({ requestWeight: 1 }).allowed, true);
});

test('updates current limits from Futures exchangeInfo', () => {
  const coordinator = createBinanceRateCoordinator();
  coordinator.updateLimitsFromExchangeInfo({
    rateLimits: [
      { rateLimitType: 'REQUEST_WEIGHT', interval: 'MINUTE', intervalNum: 1, limit: 2_500 },
      { rateLimitType: 'ORDERS', interval: 'MINUTE', intervalNum: 1, limit: 1_300 },
      { rateLimitType: 'ORDERS', interval: 'SECOND', intervalNum: 10, limit: 320 }
    ]
  });

  assert.deepEqual(coordinator.getState().limits, {
    orderCount10s: 320,
    orderCount1m: 1_300,
    requestWeight1m: 2_500
  });
});

test('does not replace the Futures safety ceiling with Spot exchangeInfo', () => {
  const coordinator = createBinanceRateCoordinator();
  coordinator.updateLimitsFromExchangeInfo({
    product: 'spot',
    rateLimits: [
      {
        rateLimitType: 'REQUEST_WEIGHT',
        interval: 'MINUTE',
        intervalNum: 1,
        limit: 6_000
      }
    ]
  });

  assert.equal(coordinator.getState().limits.requestWeight1m, 2_400);
});

test('estimates conservative endpoint and order costs', () => {
  assert.deepEqual(estimateBinanceRateCost({
    endpoint: '/fapi/v1/klines',
    params: { limit: 1_500 }
  }), { orderCount: 0, requestWeight: 10 });
  assert.deepEqual(estimateBinanceRateCost({
    endpoint: '/fapi/v1/openOrders',
    params: {}
  }), { orderCount: 0, requestWeight: 40 });
  assert.deepEqual(estimateBinanceRateCost({
    endpoint: '/fapi/v1/order',
    method: 'POST',
    params: { symbol: 'BTCUSDT' }
  }), { orderCount: 1, requestWeight: 1 });
  assert.deepEqual(estimateBinanceRateCost({
    endpoint: '/fapi/v1/commissionRate',
    params: { symbol: 'BTCUSDT' }
  }), { orderCount: 0, requestWeight: 20 });
  assert.deepEqual(estimateBinanceRateCost({
    endpoint: '/fapi/v1/positionSide/dual'
  }), { orderCount: 0, requestWeight: 30 });
  assert.deepEqual(estimateBinanceRateCost({
    endpoint: '/api/v3/openOrders',
    params: {}
  }), { orderCount: 0, requestWeight: 80 });
  assert.deepEqual(estimateBinanceRateCost({
    endpoint: '/api/v3/myTrades',
    params: { symbol: 'BTCUSDT' }
  }), { orderCount: 0, requestWeight: 20 });
  assert.deepEqual(estimateBinanceRateCost({
    endpoint: '/sapi/v1/algo/spot/newOrderAlgo',
    method: 'POST',
    params: { symbol: 'BTCUSDT' }
  }), { orderCount: 1, requestWeight: 10 });
  assert.throws(
    () => estimateBinanceRateCost({
      endpoint: '/sapi/v1/new-high-weight-endpoint'
    }),
    error => error.code === 'UNKNOWN_BINANCE_ENDPOINT_WEIGHT'
  );
  assert.throws(
    () => estimateBinanceRateCost({
      endpoint: '/api/v3/new-high-weight-endpoint'
    }),
    error => error.code === 'UNKNOWN_BINANCE_ENDPOINT_WEIGHT'
  );
});

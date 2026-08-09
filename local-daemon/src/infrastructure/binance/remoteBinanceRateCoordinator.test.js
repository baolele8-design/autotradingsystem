import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRemoteBinanceRateCoordinator
} from './remoteBinanceRateCoordinator.js';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status
  });
}

test('remote coordinator fails closed when the daemon is unavailable', async () => {
  const coordinator = createRemoteBinanceRateCoordinator({
    baseUrl: 'http://127.0.0.1:1338',
    fetchImpl: async () => {
      throw new Error('connection refused');
    },
    timeoutMs: 25
  });

  const result = await coordinator.reserve({ requestWeight: 1 });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'COORDINATOR_UNAVAILABLE');
  assert.equal(coordinator.getState().available, false);
});

test('remote coordinator preserves a central budget denial', async () => {
  const calls = [];
  const coordinator = createRemoteBinanceRateCoordinator({
    baseUrl: 'http://127.0.0.1:1338/',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return response({
        reservation: {
          allowed: false,
          reason: 'ORDER_COUNT_BUDGET_EXHAUSTED'
        },
        state: { used: { orderCount1m: 100 } }
      }, 429);
    }
  });

  const result = await coordinator.reserve({ orderCount: 1 });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'ORDER_COUNT_BUDGET_EXHAUSTED');
  assert.equal(calls[0].url, 'http://127.0.0.1:1338/internal/binance-rate/reserve');
  assert.equal(coordinator.getState().available, true);
});

test('remote coordinator forwards only rate-limit response metadata', async () => {
  let sentBody;
  const coordinator = createRemoteBinanceRateCoordinator({
    baseUrl: 'http://127.0.0.1:1338',
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return response({ state: {} });
    }
  });

  await coordinator.observeResponse({
    headers: new Headers({
      authorization: 'must-not-forward',
      'retry-after': '2',
      'x-mbx-used-weight-1m': '40'
    }),
    status: 429
  });

  assert.deepEqual(sentBody, {
    headers: {
      'retry-after': '2',
      'x-mbx-used-weight-1m': '40'
    },
    status: 429
  });
});

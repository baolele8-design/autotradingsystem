import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBinanceGateway,
  createBinanceRequestGovernor
} from './binanceGateway.js';

function jsonResponse(value, { status = 200, weight = '1' } = {}) {
  return new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json',
      'x-mbx-used-weight-1m': weight
    },
    status
  });
}

test('coalesces identical Binance requests and serves the TTL cache', async () => {
  let calls = 0;
  const governor = createBinanceRequestGovernor({
    fetchImpl: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return jsonResponse({ ok: true });
    }
  });

  const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
  const [left, right] = await Promise.all([
    governor.fetchJson(url, { ttlMs: 10_000 }),
    governor.fetchJson(url, { ttlMs: 10_000 })
  ]);
  const cached = await governor.fetchJson(url, { ttlMs: 10_000 });

  assert.deepEqual(left, { ok: true });
  assert.deepEqual(right, { ok: true });
  assert.deepEqual(cached, { ok: true });
  assert.equal(calls, 1);
});

test('pauses non-execution traffic before exhausting request weight', async () => {
  let calls = 0;
  const governor = createBinanceRequestGovernor({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ ok: true }, { weight: '1900' });
    }
  });

  await governor.fetchJson(
    'https://fapi.binance.com/fapi/v1/time',
    { ttlMs: 0 }
  );
  const paused = await governor.fetchJson(
    'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT',
    { ttlMs: 0 }
  );

  assert.equal(paused, null);
  assert.equal(calls, 1);
  assert.equal(governor.getState().usedWeight1m, 1900);
});

test('does not coalesce protection reads behind a denied lower-priority read', async () => {
  let releaseAccount;
  const accountGate = new Promise(resolve => {
    releaseAccount = resolve;
  });
  let fetchCalls = 0;
  const governor = createBinanceRequestGovernor({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ protected: true });
    },
    rateCoordinator: {
      reserve: async ({ priority }) => {
        if (priority === 'account') {
          await accountGate;
          return { allowed: false, reason: 'ACCOUNT_BUDGET_EXHAUSTED' };
        }
        return { allowed: true };
      },
      observeResponse: async () => {},
      updateLimitsFromExchangeInfo: async () => {},
      getState: () => ({ limits: {}, used: {} })
    }
  });
  const url = 'https://fapi.binance.com/fapi/v2/positionRisk';

  const accountRead = governor.fetchJson(url, {
    priority: 'account',
    ttlMs: 0
  });
  const protectionRead = governor.fetchJson(url, {
    priority: 'protection',
    ttlMs: 0
  });
  releaseAccount();

  assert.equal(await accountRead, null);
  assert.deepEqual(await protectionRead, { protected: true });
  assert.equal(fetchCalls, 1);
});

test('pre-charges signed order mutations and observes Binance headers', async () => {
  const reservations = [];
  const observations = [];
  let axiosCalls = 0;
  const rateCoordinator = {
    reserve: async cost => {
      reservations.push(cost);
      return { allowed: true };
    },
    observeResponse: async response => observations.push(response),
    updateLimitsFromExchangeInfo: async () => {},
    getState: () => ({
      limits: { requestWeight1m: 2_400 },
      used: { requestWeight1m: 1 }
    })
  };
  const gateway = createBinanceGateway({
    axiosImpl: async request => {
      axiosCalls += 1;
      return {
        data: { orderId: 123 },
        headers: { 'x-mbx-order-count-1m': '1' },
        status: 200,
        request
      };
    },
    fetchImpl: async () => jsonResponse({}),
    getTimeOffset: () => 0,
    rateCoordinator,
    readApiKey: 'read-key',
    readApiSecret: 'read-secret',
    tradeApiKey: 'trade-key',
    tradeApiSecret: 'trade-secret'
  });

  const response = await gateway.sendBinanceReq(
    'POST',
    '/fapi/v1/order',
    { side: 'BUY', symbol: 'BTCUSDT', type: 'MARKET' }
  );

  assert.equal(response.data.orderId, 123);
  assert.equal(axiosCalls, 1);
  assert.equal(reservations[0].orderCount, 1);
  assert.equal(reservations[0].priority, 'execution');
  assert.equal(observations.length, 1);
});

test('fails a signed mutation closed before Axios when budget is denied', async () => {
  let axiosCalls = 0;
  const gateway = createBinanceGateway({
    axiosImpl: async () => {
      axiosCalls += 1;
      return { data: {}, status: 200 };
    },
    fetchImpl: async () => jsonResponse({}),
    getTimeOffset: () => 0,
    rateCoordinator: {
      reserve: async () => ({
        allowed: false,
        reason: 'REQUEST_WEIGHT_BUDGET_EXHAUSTED'
      }),
      observeResponse: async () => {},
      updateLimitsFromExchangeInfo: async () => {},
      getState: () => ({ limits: {}, used: {} })
    },
    readApiKey: 'read-key',
    readApiSecret: 'read-secret',
    tradeApiKey: 'trade-key',
    tradeApiSecret: 'trade-secret'
  });

  await assert.rejects(
    gateway.sendBinanceReq('POST', '/fapi/v1/order', { symbol: 'BTCUSDT' }),
    error => error.code === 'BINANCE_RATE_BUDGET_DENIED'
  );
  assert.equal(axiosCalls, 0);
});

test('exposes safe telemetry before a remote coordinator has connected', () => {
  const gateway = createBinanceGateway({
    fetchImpl: async () => jsonResponse({}),
    getTimeOffset: () => 0,
    rateCoordinator: {
      reserve: async () => ({ allowed: false }),
      observeResponse: async () => {},
      updateLimitsFromExchangeInfo: async () => {},
      getState: () => ({ available: false, coordinator: 'remote' })
    },
    readApiKey: '',
    readApiSecret: '',
    tradeApiKey: '',
    tradeApiSecret: ''
  });

  assert.equal(gateway.getRateLimitState().usedWeight1m, 0);
  assert.equal(gateway.getRateLimitState().requestWeightLimit, null);
});

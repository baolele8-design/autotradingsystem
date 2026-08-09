import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerRoutes,
  validateLiveExecutionStrategy
} from './registerRoutes.js';

const makeRequest = (overrides = {}) => ({
  strategyId: 'ADAPTIVE_LONG_FALLBACK',
  strategyRolloutMode: 'LIVE',
  direction: 'LONG',
  batchOrders: [{ side: 'BUY', type: 'MARKET' }],
  ...overrides
});

test('accepts catalog-backed LIVE strategy metadata with a matching entry side', () => {
  const result = validateLiveExecutionStrategy(makeRequest());

  assert.equal(result.ok, true);
  assert.equal(result.strategy.strategyId, 'ADAPTIVE_LONG_FALLBACK');
});

test('fails closed when stable strategy metadata is absent', () => {
  const result = validateLiveExecutionStrategy(
    makeRequest({ strategyId: undefined })
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.code, 'STRATEGY_METADATA_REQUIRED');
});

test('rejects a strategy when client claims PAPER_ONLY but catalog is LIVE', () => {
  const result = validateLiveExecutionStrategy(
    makeRequest({
      strategyId: 'CAPITULATION_RECLAIM',
      strategyRolloutMode: 'PAPER_ONLY'
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, 'STRATEGY_ROLLOUT_MISMATCH');
});

test('accepts a client that claims a LIVE catalog strategy as LIVE', () => {
  const result = validateLiveExecutionStrategy(
    makeRequest({ strategyId: 'CAPITULATION_RECLAIM' })
  );

  assert.equal(result.ok, true);
});

test('rejects a strategy whose supported direction differs from the request', () => {
  const result = validateLiveExecutionStrategy(
    makeRequest({
      direction: 'SHORT',
      batchOrders: [{ side: 'SELL', type: 'MARKET' }]
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.code, 'STRATEGY_DIRECTION_MISMATCH');
});

test('rejects an entry side that conflicts with the verified direction', () => {
  const result = validateLiveExecutionStrategy(
    makeRequest({ batchOrders: [{ side: 'SELL', type: 'MARKET' }] })
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.code, 'ORDER_DIRECTION_MISMATCH');
});

test('execute-batch rejects rollout mismatch before any Binance mutation', async () => {
  const handlers = new Map();
  const app = {
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    delete: (path, handler) => handlers.set(`DELETE ${path}`, handler)
  };
  let binanceMutationCount = 0;
  registerRoutes({
    app,
    cancelExactOrder: async () => {
      binanceMutationCount += 1;
    },
    geminiApiKey: '',
    getMvrvState: () => ({}),
    getRateLimitState: () => ({}),
    getTimeOffset: () => 0,
    readApiKey: '',
    readApiSecret: '',
    readBinanceReq: async () => {
      throw new Error('readBinanceReq must not run for rollout mismatch');
    },
    sendBinanceReq: async () => {
      binanceMutationCount += 1;
    },
    setGlobalMvrvZScore: () => {},
    tradeApiKey: '',
    tradeApiSecret: '',
    withSymbolOrderLock: async callback => callback()
  });

  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    }
  };
  const handler = handlers.get('POST /api/execute-batch');
  await handler(
    {
      body: {
        ...makeRequest({
          strategyId: 'CAPITULATION_RECLAIM',
          strategyRolloutMode: 'PAPER_ONLY'
        }),
        symbol: 'BTCUSDT',
        tradeType: 'FUTURES',
        leverage: 1,
        marginType: 'ISOLATED'
      }
    },
    response
  );

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, 'STRATEGY_ROLLOUT_MISMATCH');
  assert.equal(binanceMutationCount, 0);
});

test('execute-batch rejects a blocked new-entry symbol before any Binance mutation', async () => {
  const handlers = new Map();
  let binanceMutationCount = 0;
  registerRoutes({
    app: {
      post: (path, handler) => handlers.set(`POST ${path}`, handler),
      get: (path, handler) => handlers.set(`GET ${path}`, handler),
      delete: (path, handler) => handlers.set(`DELETE ${path}`, handler)
    },
    getMvrvState: () => ({}),
    getRateLimitState: () => ({}),
    readBinanceReq: async () => {
      throw new Error('readBinanceReq must not run for a blocked symbol');
    },
    sendBinanceReq: async () => {
      binanceMutationCount += 1;
    },
    setGlobalMvrvZScore: () => {}
  });
  const response = {
    statusCode: 0,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };

  await handlers.get('POST /api/execute-batch')({
    body: {
      ...makeRequest(),
      leverage: 3,
      marginType: 'ISOLATED',
      symbol: '1000XECUSDT',
      tradeType: 'FUTURES'
    }
  }, response);

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'BLOCKED_NEW_ENTRY_SYMBOL');
  assert.equal(binanceMutationCount, 0);
});

test('execute-batch sends accepted Futures orders only through the gateway', async () => {
  const handlers = new Map();
  const calls = [];
  registerRoutes({
    app: {
      post: (path, handler) => handlers.set(`POST ${path}`, handler),
      get: (path, handler) => handlers.set(`GET ${path}`, handler),
      delete: (path, handler) => handlers.set(`DELETE ${path}`, handler)
    },
    cancelExactOrder: async () => {},
    geminiApiKey: '',
    getMvrvState: () => ({}),
    getRateLimitState: () => ({ usedWeight1m: 4 }),
    readBinanceReq: async endpoint => {
      assert.equal(endpoint, '/fapi/v1/positionSide/dual');
      return { dualSidePosition: false };
    },
    readSpotBinanceReq: async () => ({}),
    safeFetch: async () => ({}),
    sendBinanceReq: async (method, endpoint, params) => {
      calls.push({ method, endpoint, params });
      return { data: { endpoint }, status: 200 };
    },
    sendSpotBinanceReq: async () => {
      throw new Error('spot gateway must not run');
    },
    setGlobalMvrvZScore: () => {},
    withSymbolOrderLock: async callback => callback()
  });
  const response = {
    statusCode: 0,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };

  await handlers.get('POST /api/execute-batch')({
    body: {
      ...makeRequest(),
      leverage: 3,
      marginType: 'ISOLATED',
      symbol: 'BTCUSDT',
      tradeType: 'FUTURES'
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    calls.map(call => call.endpoint),
    ['/fapi/v1/marginType', '/fapi/v1/leverage', '/fapi/v1/order']
  );
});

test('Binance proxy rejects arbitrary origins and routes public reads via safeFetch', async () => {
  const handlers = new Map();
  const safeFetchCalls = [];
  registerRoutes({
    app: {
      post: (path, handler) => handlers.set(`POST ${path}`, handler),
      get: (path, handler) => handlers.set(`GET ${path}`, handler),
      delete: (path, handler) => handlers.set(`DELETE ${path}`, handler)
    },
    getMvrvState: () => ({}),
    getRateLimitState: () => ({ usedWeight1m: 12 }),
    safeFetch: async url => {
      safeFetchCalls.push(url);
      return { symbols: [] };
    },
    setGlobalMvrvZScore: () => {}
  });
  const makeResponse = () => ({
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return body; }
  });
  const handler = handlers.get('GET /api/binance');
  const invalid = makeResponse();
  await handler({ query: { path: 'https://example.com/private' } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(safeFetchCalls.length, 0);

  const unapproved = makeResponse();
  await handler({
    query: { path: '/sapi/v1/capital/config/getall' }
  }, unapproved);
  assert.equal(unapproved.statusCode, 400);
  assert.equal(safeFetchCalls.length, 0);

  const valid = makeResponse();
  await handler({
    query: { path: '/fapi/v1/exchangeInfo', t: 'cache-buster' }
  }, valid);
  assert.equal(valid.statusCode, 200);
  assert.equal(
    safeFetchCalls[0],
    'https://fapi.binance.com/fapi/v1/exchangeInfo'
  );
  assert.equal(valid.headers['x-mbx-used-weight-1m'], '12');
});

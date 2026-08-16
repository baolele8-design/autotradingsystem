import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerRoutes,
  validateLiveExecutionStrategy
} from './registerRoutes.js';
import {
  buildBtcRegimeSnapshot
} from '../../domain/execution/btcRegimeFrame.js';

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
    patch: (path, handler) => handlers.set(`PATCH ${path}`, handler),
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
      patch: (path, handler) => handlers.set(`PATCH ${path}`, handler),
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
      patch: (path, handler) => handlers.set(`PATCH ${path}`, handler),
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
      patch: (path, handler) => handlers.set(`PATCH ${path}`, handler),
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

  // TD-005 guard (2026-08-12): useExchangeConfig.js now reads the 24hr ticker
  // through this proxy — the path must stay allowlisted.
  const ticker = makeResponse();
  await handler({
    query: { path: '/fapi/v1/ticker/24hr', t: 'cache-buster' }
  }, ticker);
  assert.equal(ticker.statusCode, 200);
  assert.equal(
    safeFetchCalls[1],
    'https://fapi.binance.com/fapi/v1/ticker/24hr'
  );
});

// O10 (team-D 2026-08-12): GET /api/btc-regime surfaces the scanner snapshot.
test('GET /api/btc-regime returns the scanner regime snapshot', async () => {
  const handlers = new Map();
  registerRoutes({
    app: {
      get: (path, handler) => handlers.set(`GET ${path}`, handler),
      post: () => {},
      patch: () => {},
      delete: () => {}
    },
    getBtcRegimeSnapshot: () => ({
      regime4h: 'Downtrend',
      regime1d: 'Downtrend',
      domSlope4h: 0.42,
      domSlope1d: -0.1,
      btcDomValue: 58.5,
      isAltcoinBleeding: true
    })
  });
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };
  await handlers.get('GET /api/btc-regime')({}, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.regime4h, 'Downtrend');
  assert.equal(response.body.data.isAltcoinBleeding, true);
  assert.ok(response.body.timestamp);
});

test('GET /api/btc-regime fails open when snapshot getter is absent', async () => {
  const handlers = new Map();
  registerRoutes({
    app: {
      get: (path, handler) => handlers.set(`GET ${path}`, handler),
      post: () => {},
      patch: () => {},
      delete: () => {}
    }
  });
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };
  await handlers.get('GET /api/btc-regime')({}, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data, null);
});

// F-E1b (2026-08-12): GET /api/btc-regime regression with an OBJECT regime
// cache (scanner stores {regime, msbState, ...} now) — the snapshot must
// read .regime and keep returning plain regime strings.
test('GET /api/btc-regime reads .regime from object cache entries', async () => {
  const handlers = new Map();
  registerRoutes({
app: {
      get: (path, handler) => handlers.set(`GET ${path}`, handler),
      post: () => {},
      patch: () => {},
      delete: () => {}
    },
    getBtcRegimeSnapshot: () => buildBtcRegimeSnapshot({
      regimeCache: new Map([
        ['4h', { regime: 'Downtrend', msbState: 'Bearish_MSB', isSFP: null }],
        ['1d', { regime: 'Uptrend', msbState: 'Bullish_MSB', isSFP: null }]
      ]),
      domCache: new Map([['4h', { slope: 0.42 }], ['1d', { slope: -0.1 }]]),
      btcDominance: 58.5
    })
  });
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };
  await handlers.get('GET /api/btc-regime')({}, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.regime4h, 'Downtrend');
  assert.equal(response.body.data.regime1d, 'Uptrend');
  assert.equal(response.body.data.isAltcoinBleeding, true);
});

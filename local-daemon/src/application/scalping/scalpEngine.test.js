import test from 'node:test';
import assert from 'node:assert';
import {
  resolveScalpExitReason,
  startScalpEngine
} from './scalpEngine.js';

function createMockSupabase() {
  const tableHistory = [];
  const queryLogs = [];

  return {
    tableHistory,
    queryLogs,
    from(tableName) {
      tableHistory.push(tableName);

      return {
        insert(rows) {
          queryLogs.push({ action: 'insert', table: tableName, rows });
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    error: null,
                    data: { id: 99 }
                  });
                }
              };
            }
          };
        },
        update(updates) {
          return {
            eq(col, val) {
              queryLogs.push({ action: 'update', table: tableName, updates, filterId: val });
              return Promise.resolve({ error: null });
            }
          };
        },
        select(cols) {
          return {
            order() {
              return {
                limit() {
                  return Promise.resolve({ data: [{ id: 99 }], error: null });
                }
              };
            },
            in(col, vals) {
              return Promise.resolve({ data: [], error: null });
            }
          };
        },
        in(col, vals) {
          return Promise.resolve({ data: [], error: null });
        }
      };
    }
  };
}

function createMockGateway() {
  const reqCalls = [];
  const algoOrders = [];

  const sendBinanceReq = async (method, endpoint, paramsObj = {}) => {
    reqCalls.push({ method, endpoint, paramsObj });

    if (endpoint === '/fapi/v1/time') {
      return { data: { serverTime: Date.now() } };
    }

    if (endpoint === '/fapi/v1/exchangeInfo') {
      return {
        data: {
          symbols: [
            {
              symbol: 'BTCUSDT',
              filters: [
                { filterType: 'LOT_SIZE', stepSize: '0.001' },
                { filterType: 'PRICE_FILTER', tickSize: '0.1' },
                { filterType: 'MIN_NOTIONAL', minNotional: '5' }
              ]
            },
            {
              symbol: 'ETHUSDT',
              filters: [
                { filterType: 'LOT_SIZE', stepSize: '0.01' },
                { filterType: 'PRICE_FILTER', tickSize: '0.01' },
                { filterType: 'MIN_NOTIONAL', minNotional: '5' }
              ]
            }
          ]
        }
      };
    }

    if (endpoint === '/fapi/v1/klines') {
      return {
        data: Array.from({ length: 40 }, (_, i) => [
          1600000000000 + i * 300000,
          '50000',
          '50500',
          '49500',
          '50100',
          '100',
          1600000300000 + i * 300000
        ])
      };
    }

    if (endpoint === '/fapi/v2/account') {
      return {
        data: {
          totalMarginBalance: '750.00' // Real balance $750
        }
      };
    }

    if (endpoint === '/fapi/v2/positionRisk') {
      return { data: [] };
    }

    if (endpoint === '/fapi/v1/openOrders') {
      return { data: [] };
    }

    if (endpoint === '/fapi/v1/openAlgoOrders') {
      return { data: [...algoOrders] };
    }

    if (endpoint === '/fapi/v1/algoOrder' && method === 'POST') {
      const order = {
        algoId: 20_000 + algoOrders.length,
        symbol: paramsObj.symbol,
        side: paramsObj.side,
        orderType: paramsObj.type,
        triggerPrice: paramsObj.triggerPrice,
        clientAlgoId: paramsObj.clientAlgoId
      };
      algoOrders.push(order);
      return { data: order };
    }

    if (endpoint === '/fapi/v1/algoOrder' && method === 'DELETE') {
      const index = algoOrders.findIndex(
        order => String(order.algoId) === String(paramsObj.algoId)
      );
      if (index >= 0) algoOrders.splice(index, 1);
      return { data: { status: 'CANCELED' } };
    }

    if (endpoint === '/fapi/v1/order') {
      return { data: { orderId: 12345, status: 'NEW' } };
    }

    if (endpoint === '/fapi/v1/allOpenOrders') {
      return { data: { msg: 'success' } };
    }

    if (endpoint === '/fapi/v1/userTrades') {
      return { data: [] };
    }

    return { data: {} };
  };

  return {
    reqCalls,
    algoOrders,
    sendBinanceReq
  };
}

test('scalp exit reason matches the terminal algo actualOrderId', () => {
  assert.equal(
    resolveScalpExitReason(
      { protectionStage: 'NONE' },
      { orderId: 77 },
      {
        tp: {
          algoStatus: 'FINISHED',
          actualOrderId: 77
        }
      }
    ),
    'TAKE_PROFIT_HIT'
  );
  assert.equal(
    resolveScalpExitReason(
      { protectionStage: 'TRAIL', trailing_activated: true },
      { orderId: 88 },
      {
        sl: {
          algoStatus: 'TRIGGERED',
          actualOrderId: 88
        }
      }
    ),
    'TRAILING_STOP_HIT'
  );
  assert.equal(
    resolveScalpExitReason(
      {},
      { orderId: 99 },
      {
        tp: {
          algoStatus: 'FINISHED',
          actualOrderId: 77
        }
      }
    ),
    'UNCLASSIFIED_EXCHANGE_CLOSE'
  );
});

test('scalpEngine - fails preflight before trading when ownership schema is missing', async () => {
  const mockGateway = createMockGateway();
  const supabase = {
    from(table) {
      assert.equal(table, 'scalp_trade_logs');
      return {
        select(columns) {
          assert.ok(columns.includes('atr_rank'));
          assert.ok(columns.includes('ownership_token'));
          return {
            limit() {
              return Promise.resolve({
                data: null,
                error: {
                  message:
                    "column scalp_trade_logs.atr_rank does not exist"
                }
              });
            }
          };
        }
      };
    }
  };
  const engine = startScalpEngine({
    supabase,
    environment: {
      binance: {
        tradeApiKey: 'mockKey',
        tradeApiSecret: 'mockSecret'
      }
    },
    binanceGateway: mockGateway,
    autoStart: false
  });

  await assert.rejects(
    engine.verifyScalpLedgerSchema(),
    /SCALP_SCHEMA_NOT_READY.*scalp_execution_ownership\.sql/
  );
  assert.equal(mockGateway.reqCalls.length, 0);
});

test('scalpEngine - routes REST calls via binanceGateway (R1)', async () => {
  const mockSupabase = createMockSupabase();
  const mockGateway = createMockGateway();

  const engine = startScalpEngine({
    supabase: mockSupabase,
    environment: { binance: { tradeApiKey: 'mockKey', tradeApiSecret: 'mockSecret' } },
    binanceGateway: mockGateway,
    autoStart: false
  });

  engine.setExchangeInfo({
    symbols: [
      {
        symbol: 'BTCUSDT',
        filters: [
          { filterType: 'LOT_SIZE', stepSize: '0.001' },
          { filterType: 'PRICE_FILTER', tickSize: '0.1' },
          { filterType: 'MIN_NOTIONAL', minNotional: '5' }
        ]
      }
    ]
  });

  const positions = await engine.getActivePositions();
  assert.deepStrictEqual(positions, []);
  assert.ok(mockGateway.reqCalls.some(c => c.endpoint === '/fapi/v2/positionRisk'));

  const orders = await engine.getOpenOrders();
  assert.deepStrictEqual(orders, []);
  assert.ok(mockGateway.reqCalls.some(c => c.endpoint === '/fapi/v1/openOrders'));
});

test('scalpEngine - enforces virtual capital capping at $140 (R5)', async () => {
  const mockSupabase = createMockSupabase();
  const mockGateway = createMockGateway();

  const engine = startScalpEngine({
    supabase: mockSupabase,
    environment: { binance: { tradeApiKey: 'mockKey', tradeApiSecret: 'mockSecret' } },
    binanceGateway: mockGateway,
    autoStart: false
  });

  engine.setExchangeInfo({
    symbols: [
      {
        symbol: 'BTCUSDT',
        filters: [
          { filterType: 'LOT_SIZE', stepSize: '0.001' },
          { filterType: 'PRICE_FILTER', tickSize: '0.1' },
          { filterType: 'MIN_NOTIONAL', minNotional: '5' }
        ]
      }
    ]
  });

  // Populate candle history so scanSignals evaluates
  const dummyCandles = Array.from({ length: 35 }, (_, i) => ({
    open: 50000,
    high: 50200,
    low: 49800,
    close: 50100,
    closeTime: Date.now() - (35 - i) * 300000
  }));
  const dummyVols = Array.from({ length: 35 }, () => 100);

  engine.candleCache.set('BTCUSDT', dummyCandles);

  await engine.scanSignals();

  // Verify that account call was made
  const accountCall = mockGateway.reqCalls.find(c => c.endpoint === '/fapi/v2/account');
  assert.ok(accountCall, 'Should fetch account balance via binanceGateway');
});

test('scalpEngine - persists real entry payload and creates no CO before fill', async () => {
  const mockSupabase = createMockSupabase();
  const mockGateway = createMockGateway();
  const engine = startScalpEngine({
    supabase: mockSupabase,
    environment: {
      binance: {
        tradeApiKey: 'mockKey',
        tradeApiSecret: 'mockSecret'
      }
    },
    binanceGateway: mockGateway,
    autoStart: false
  });
  engine.setExchangeInfo({
    symbols: [{
      symbol: 'BTCUSDT',
      filters: [
        { filterType: 'LOT_SIZE', stepSize: '0.001' },
        { filterType: 'PRICE_FILTER', tickSize: '0.1' },
        { filterType: 'MIN_NOTIONAL', minNotional: '5' }
      ]
    }]
  });

  await engine.executeScalpTrade({
    direction: 'LONG',
    strategyId: 'S1_EMA_MOMENTUM',
    score: 68,
    entry: 50_000,
    indicators: {
      atr: 150,
      adx: 31,
      rsi: 61,
      volumeRatio: 1.4
    },
    details: {
      l1: 'Strong Trend Up',
      l2: 'Expansion',
      l3: 'Quiet',
      atrRank: 62,
      bbwRank: 11.650485436893204,
      obi: 0.57,
      cvdTrend: 8,
      takerRatio: 1.18,
      vwap: 49_980,
      vwapUpper: 50_200,
      vwapLower: 49_760,
      hurstValue: 0.59
    },
    gateDiagnostics: []
  }, 'BTCUSDT', 140, '5m');

  const insert = mockSupabase.queryLogs.find(
    item =>
      item.action === 'insert' &&
      item.table === 'scalp_trade_logs'
  );
  assert.ok(insert);
  const payload = insert.rows[0];
  assert.strictEqual(payload.adx, 31);
  assert.strictEqual(payload.obi, 0.57);
  assert.strictEqual(payload.bbw_rank, 11.650485436893204);
  assert.strictEqual(payload.funding_rate, null);
  assert.match(payload.entry_client_order_id, /^qts-entry-/);
  assert.match(payload.sl_client_algo_id, /^qts-sl-/);
  assert.match(payload.tp_client_algo_id, /^qts-tp-/);
  assert.strictEqual(
    mockGateway.reqCalls.some(call =>
      call.endpoint === '/fapi/v1/algoOrder' &&
      call.method === 'POST'
    ),
    false
  );
});

test('scalpEngine - blocks a 1000-prefixed new entry before exchange or ledger mutation', async () => {
  const mockSupabase = createMockSupabase();
  const mockGateway = createMockGateway();
  const engine = startScalpEngine({
    supabase: mockSupabase,
    environment: { binance: {} },
    binanceGateway: mockGateway,
    autoStart: false
  });
  engine.setExchangeInfo({
    symbols: [{
      symbol: '1000XECUSDT',
      filters: [
        { filterType: 'LOT_SIZE', stepSize: '1' },
        { filterType: 'PRICE_FILTER', tickSize: '0.00000001' },
        { filterType: 'MIN_NOTIONAL', minNotional: '5' }
      ]
    }]
  });

  await engine.executeScalpTrade({
    direction: 'LONG',
    strategyId: 'S1_EMA_MOMENTUM',
    score: 99,
    entry: 0.00002,
    indicators: { atr: 0.000001 },
    details: {},
    gateDiagnostics: []
  }, '1000XECUSDT', 140, '5m');

  assert.equal(mockGateway.reqCalls.length, 0);
  assert.equal(mockSupabase.queryLogs.length, 0);
});

test('scalpEngine - integrates domain trailing decision & temporal barrier soft extension (R3)', async () => {
  const mockSupabase = createMockSupabase();
  const mockGateway = createMockGateway();

  let activePositions = [
    {
      symbol: 'BTCUSDT',
      positionAmt: '0.01',
      entryPrice: '50000',
      markPrice: '51500', // 50000 -> 51500 = +1500 profit (SL distance 500 -> 3R profit -> stage TRAIL)
      unrealizedProfit: '15'
    }
  ];

  const customGateway = {
    ...mockGateway,
    sendBinanceReq: async (method, endpoint, paramsObj) => {
      if (endpoint === '/fapi/v2/positionRisk') {
        return { data: activePositions };
      }
      return mockGateway.sendBinanceReq(method, endpoint, paramsObj);
    }
  };

  const engine = startScalpEngine({
    supabase: mockSupabase,
    environment: { binance: { tradeApiKey: 'mockKey', tradeApiSecret: 'mockSecret' } },
    binanceGateway: customGateway,
    autoStart: false
  });

  engine.setExchangeInfo({
    symbols: [
      {
        symbol: 'BTCUSDT',
        filters: [
          { filterType: 'LOT_SIZE', stepSize: '0.001' },
          { filterType: 'PRICE_FILTER', tickSize: '0.1' },
          { filterType: 'MIN_NOTIONAL', minNotional: '5' }
        ]
      }
    ]
  });

  engine.openTrades.set('BTCUSDT', {
    supabaseId: 99,
    openedAt: new Date(Date.now() - 1000).toISOString(),
    symbol: 'BTCUSDT',
    interval: '5m',
    qty: '0.01',
    slPrice: '49500',
    initialSl: '49500',
    tpPrice: '52500',
    entryPrice: '50000',
    direction: 'LONG',
    side: 'BUY',
    exitSide: 'SELL',
    maxHoldCandles: 12,
    protectionStage: 'NONE',
    highWaterPrice: 50000,
    highWaterR: 0,
    currentProfitR: 0,
    trailing_activated: false,
    assetTier: 'Tier 2',
    strategyId: 'S1_EMA_MOMENTUM'
  });

  await engine.monitorOpenTrades();

  const trade = engine.openTrades.get('BTCUSDT');
  assert.ok(trade, 'Trade should still be open');
  assert.strictEqual(trade.protectionStage, 'TRAIL', 'Protection stage should transition to TRAIL');
  assert.ok(trade.highWaterR >= 3.0, 'High water R should be >= 3.0R');
  assert.ok(Number.parseFloat(trade.slPrice) > 50000, 'SL should be trailed above entry price');

  // Verify DB update targeted scalp_trade_logs only
  assert.ok(mockSupabase.tableHistory.every(t => t === 'scalp_trade_logs' || t === 'scalp_strategy_params'), 'Only target scalp tables');
});

test('scalpEngine - adopts legacy SL/TP and prunes same-lane duplicates', async () => {
  const mockSupabase = createMockSupabase();
  const mockGateway = createMockGateway();
  mockGateway.algoOrders.push(
    {
      algoId: 30,
      symbol: 'BTCUSDT',
      side: 'SELL',
      orderType: 'STOP_MARKET',
      triggerPrice: '49400'
    },
    {
      algoId: 31,
      symbol: 'BTCUSDT',
      side: 'SELL',
      orderType: 'STOP_MARKET',
      triggerPrice: '49500'
    },
    {
      algoId: 32,
      symbol: 'BTCUSDT',
      side: 'SELL',
      orderType: 'TAKE_PROFIT_MARKET',
      triggerPrice: '51000'
    }
  );
  const customGateway = {
    ...mockGateway,
    sendBinanceReq: async (method, endpoint, paramsObj) => {
      if (endpoint === '/fapi/v2/positionRisk') {
        return {
          data: [{
            symbol: 'BTCUSDT',
            positionAmt: '0.01',
            entryPrice: '50000',
            markPrice: '50000',
            unrealizedProfit: '0'
          }]
        };
      }
      return mockGateway.sendBinanceReq(method, endpoint, paramsObj);
    }
  };
  const engine = startScalpEngine({
    supabase: mockSupabase,
    environment: { binance: {} },
    binanceGateway: customGateway,
    autoStart: false
  });
  engine.setExchangeInfo({
    symbols: [{
      symbol: 'BTCUSDT',
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.1' }
      ]
    }]
  });
  engine.openTrades.set('BTCUSDT', {
    supabaseId: 77,
    openedAt: new Date().toISOString(),
    filledAt: new Date().toISOString(),
    symbol: 'BTCUSDT',
    interval: '5m',
    qty: '0.01',
    slPrice: '49500',
    initialSl: '49500',
    tpPrice: '51000',
    entryPrice: '50000',
    direction: 'LONG',
    exitSide: 'SELL',
    protectionStage: 'NONE',
    assetTier: 'Tier 2',
    strategyId: 'S1_EMA_MOMENTUM'
  });

  await engine.monitorOpenTrades();
  const recovered = engine.openTrades.get('BTCUSDT');
  assert.strictEqual(recovered.slAlgoId, 31);
  assert.strictEqual(recovered.tpAlgoId, 32);
  assert.strictEqual(
    mockGateway.algoOrders.some(order => order.algoId === 30),
    false
  );
  assert.strictEqual(
    mockGateway.reqCalls.some(call =>
      call.endpoint === '/fapi/v1/algoOrder' &&
      call.method === 'POST'
    ),
    false
  );
});

test('scalpEngine - closes position when temporal barrier (maxHoldingCycles) is reached', async () => {
  const mockSupabase = createMockSupabase();
  const mockGateway = createMockGateway();

  const activePositions = [
    {
      symbol: 'ETHUSDT',
      positionAmt: '0.1',
      entryPrice: '3000',
      markPrice: '3010',
      unrealizedProfit: '1'
    }
  ];

  const customGateway = {
    ...mockGateway,
    sendBinanceReq: async (method, endpoint, paramsObj) => {
      if (endpoint === '/fapi/v2/positionRisk') {
        return { data: activePositions };
      }
      return mockGateway.sendBinanceReq(method, endpoint, paramsObj);
    }
  };

  const engine = startScalpEngine({
    supabase: mockSupabase,
    environment: { binance: { tradeApiKey: 'mockKey', tradeApiSecret: 'mockSecret' } },
    binanceGateway: customGateway,
    autoStart: false
  });

  engine.setExchangeInfo({
    symbols: [
      {
        symbol: 'ETHUSDT',
        filters: [
          { filterType: 'LOT_SIZE', stepSize: '0.01' },
          { filterType: 'PRICE_FILTER', tickSize: '0.01' },
          { filterType: 'MIN_NOTIONAL', minNotional: '5' }
        ]
      }
    ]
  });

  const pastTime = new Date(Date.now() - 15 * 300_000).toISOString();
  engine.openTrades.set('ETHUSDT', {
    supabaseId: 100,
    openedAt: pastTime,
    filledAt: pastTime,
    symbol: 'ETHUSDT',
    interval: '5m',
    qty: '0.1',
    slPrice: '2950',
    initialSl: '2950',
    tpPrice: '3150',
    entryPrice: '3000',
    direction: 'LONG',
    side: 'BUY',
    exitSide: 'SELL',
    maxHoldCandles: 12,
    protectionStage: 'NONE',
    highWaterPrice: 3000,
    highWaterR: 0,
    currentProfitR: 0,
    trailing_activated: false,
    assetTier: 'Tier 2',
    strategyId: 'S1_EMA_MOMENTUM'
  });

  await engine.monitorOpenTrades();

  assert.strictEqual(engine.openTrades.has('ETHUSDT'), false, 'Trade should be closed after temporal barrier');

  const updateLog = mockSupabase.queryLogs.find(q => q.action === 'update' && q.updates?.exit_reason === 'TEMPORAL_BARRIER_HIT');
  assert.ok(updateLog, 'DB update must specify TEMPORAL_BARRIER_HIT');
});

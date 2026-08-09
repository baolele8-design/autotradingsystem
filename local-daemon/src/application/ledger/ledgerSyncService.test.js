import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeTradeFills,
  calculateNetTradePnl,
  createLedgerSyncService,
  resolveExitReason
} from './ledgerSyncService.js';
import {
  makeInitialClientAlgoId
} from '../../domain/orders/trailingOrders.js';

function createMockSupabase(initialLogs = []) {
  let logs = [...initialLogs];
  const updateCalls = [];

  const client = {
    logs,
    updateCalls,
    from(table) {
      assert.equal(table, 'trade_logs');
      return {
        select(fields) {
          return {
            in(column, values) {
              return {
                eq(col2, val2) {
                  return {
                    order(col3, options) {
                      const filtered = logs.filter(l => values.includes(l[column]) && l[col2] === val2);
                      return Promise.resolve({ data: filtered, error: null });
                    }
                  };
                }
              };
            }
          };
        },
        update(payload) {
          return {
            eq(col, idVal) {
              updateCalls.push({ payload, id: idVal });
              const item = logs.find(l => l.id === idVal);
              if (item) {
                Object.assign(item, payload);
              }
              return Promise.resolve({ error: null });
            }
          };
        }
      };
    }
  };
  return client;
}

test('ledger attribution excludes the previous same-symbol close and includes fees plus funding', () => {
  const log = {
    symbol: 'LPTUSDT',
    direction: 'SHORT',
    created_at: '2026-07-27T00:11:49.000Z',
    opened_at: '2026-07-27T00:11:50.355Z'
  };
  const trades = [
    {
      id: 1,
      orderId: 100,
      side: 'BUY',
      time: Date.parse('2026-07-27T00:11:34.000Z'),
      price: '1.549',
      qty: '37.4',
      realizedPnl: '-2.9172'
    },
    {
      id: 2,
      orderId: 101,
      side: 'SELL',
      time: Date.parse('2026-07-27T00:11:48.500Z'),
      price: '1.555',
      qty: '35.4',
      realizedPnl: '0'
    },
    {
      id: 3,
      orderId: 102,
      side: 'BUY',
      time: Date.parse('2026-07-27T12:36:59.000Z'),
      price: '1.427',
      qty: '33.8',
      realizedPnl: '4.3264'
    },
    {
      id: 4,
      orderId: 102,
      side: 'BUY',
      time: Date.parse('2026-07-27T12:36:59.001Z'),
      price: '1.427',
      qty: '1.6',
      realizedPnl: '0.2048'
    }
  ];

  const attributed = attributeTradeFills(log, trades);
  assert.deepEqual(attributed.exitTrades.map(trade => trade.id), [3, 4]);

  const pnl = calculateNetTradePnl({
    ...attributed,
    incomeRecords: [
      {
        incomeType: 'COMMISSION',
        income: '-0.0275235',
        tradeId: 2,
        time: trades[1].time
      },
      {
        incomeType: 'FUNDING_FEE',
        income: '-0.12576654',
        tradeId: '',
        time: Date.parse('2026-07-27T08:00:00.000Z')
      },
      {
        incomeType: 'COMMISSION',
        income: '-0.0241163',
        tradeId: 3,
        time: trades[2].time
      },
      {
        incomeType: 'COMMISSION',
        income: '-0.0011416',
        tradeId: 4,
        time: trades[3].time
      },
      {
        incomeType: 'COMMISSION',
        income: '-0.02896629',
        tradeId: 1,
        time: trades[0].time
      }
    ]
  });

  assert.ok(Math.abs(pnl.grossPnl - 4.5312) < 1e-10);
  assert.ok(Math.abs(pnl.netPnl - 4.35265206) < 1e-10);
});

test('ledger preserves lifecycle exit reasons and does not invent manual or algo-triggered exits', () => {
  assert.equal(
    resolveExitReason(
      {
        direction: 'SHORT',
        entry: 1.555,
        sl: 1.65,
        tp_1_price: 1.385,
        exit_reason: 'PANIC_SELL_REVERSAL'
      },
      { orderId: 100 }
    ),
    'PANIC_SELL_REVERSAL'
  );

  const reason = resolveExitReason(
    {
      direction: 'SHORT',
      entry: 1.555,
      sl: 1.65,
      tp_1_price: 1.385,
      exit_reason: null
    },
    { orderId: 100 }
  );

  assert.equal(reason, 'UNCLASSIFIED_EXCHANGE_CLOSE');
  assert.equal(
    resolveExitReason(
      {
        direction: 'SHORT',
        entry: 1.471,
        sl: 1.631,
        tp_1_price: 1.147
      },
      { orderId: 101 }
    ),
    'UNCLASSIFIED_EXCHANGE_CLOSE'
  );
});

test('ledger exit reason requires the triggered algo actualOrderId to match the exit fill', () => {
  const log = {
    direction: 'SHORT',
    sl_algo_id: 11,
    tp_algo_id: 12,
    trailing_activated: false,
    protection_stage: 'NONE'
  };
  assert.equal(
    resolveExitReason(
      log,
      { orderId: 9002 },
      {
        sl: {
          algoStatus: 'CANCELED',
          actualOrderId: ''
        },
        tp: {
          algoStatus: 'FINISHED',
          actualOrderId: 9002
        }
      }
    ),
    'TAKE_PROFIT_HIT'
  );
  assert.equal(
    resolveExitReason(
      log,
      { orderId: 9003 },
      {
        tp: {
          algoStatus: 'FINISHED',
          actualOrderId: 9002
        }
      }
    ),
    'UNCLASSIFIED_EXCHANGE_CLOSE'
  );
});

test('ledger exit reason recognizes stable forced-exit client order IDs', () => {
  const log = { direction: 'LONG' };
  assert.equal(
    resolveExitReason(log, {
      orderId: 1,
      clientOrderId: 'qts-ex-panic-trade123'
    }),
    'PANIC_SELL_REVERSAL'
  );
  assert.equal(
    resolveExitReason(log, {
      orderId: 2,
      clientOrderId: 'qts-ex-time-trade123'
    }),
    'TEMPORAL_BARRIER_HIT'
  );
});

test('ledgerSyncService - PENDING order expires to CANCELLED_EXPIRED after 3 candles', async () => {
  const expiredTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60 mins ago (> 3x 15m candles)
  const initialLogs = [
    {
      id: 'trade-expired-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      status: 'PENDING',
      type: 'FUTURES',
      entry: 50000,
      sl: 49000,
      interval: '15m',
      strategy_name: 'VOL_COMPRESSION_IGNITION',
      soft_score: 80,
      atr_at_entry: 500,
      created_at: expiredTimestamp
    }
  ];

  const supabase = createMockSupabase(initialLogs);
  const binanceDeletes = [];

  const readBinanceReq = async (endpoint) => {
    if (endpoint === '/fapi/v2/positionRisk') {
      return [{ symbol: 'BTCUSDT', positionAmt: '0', entryPrice: '0' }];
    }
    return [];
  };

  const sendBinanceReq = async (method, endpoint, params) => {
    binanceDeletes.push({ method, endpoint, params });
    return { data: { code: 200, msg: 'Success' } };
  };

  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    readBinanceReq,
    sendBinanceReq,
    supabase
  });

  await service.runLedgerStateSync();

  assert.deepEqual(
    binanceDeletes.map(request => request.endpoint),
    [
      '/fapi/v1/algoOrder',
      '/fapi/v1/algoOrder',
      '/fapi/v1/allOpenOrders'
    ]
  );
  assert.equal(binanceDeletes[0].method, 'DELETE');
  assert.equal(
    binanceDeletes[0].params.clientAlgoId,
    makeInitialClientAlgoId('sl', 'trade-expired-1')
  );
  assert.equal(
    binanceDeletes[1].params.clientAlgoId,
    makeInitialClientAlgoId('tp', 'trade-expired-1')
  );
  assert.equal(binanceDeletes[2].params.symbol, 'BTCUSDT');

  assert.equal(supabase.updateCalls.length, 1);
  assert.equal(supabase.updateCalls[0].id, 'trade-expired-1');
  assert.equal(supabase.updateCalls[0].payload.status, 'CANCELLED_EXPIRED');
  assert.equal(supabase.updateCalls[0].payload.exit_reason, 'EXPIRED_3_CANDLES');
  assert.ok(supabase.updateCalls[0].payload.close_time);
});

test('ledgerSyncService - PENDING order invalidates to CANCELLED_INVALIDATED on gate failure', async () => {
  const recentTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 mins ago (< 3x 15m candles)
  const initialLogs = [
    {
      id: 'trade-invalidated-1',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      status: 'PENDING',
      type: 'FUTURES',
      entry: 3000,
      sl: 2900,
      interval: '15m',
      strategy_name: 'VOL_COMPRESSION_IGNITION',
      soft_score: 80,
      atr_at_entry: 50,
      created_at: recentTimestamp
    }
  ];

  const supabase = createMockSupabase(initialLogs);
  const binanceDeletes = [];

  const readBinanceReq = async (endpoint) => {
    if (endpoint === '/fapi/v2/positionRisk') {
      return [{ symbol: 'ETHUSDT', positionAmt: '0', entryPrice: '0' }];
    }
    return [];
  };

  const sendBinanceReq = async (method, endpoint, params) => {
    binanceDeletes.push({ method, endpoint, params });
    return { data: { code: 200, msg: 'Success' } };
  };

  // Provide a snapshot with MSB contradiction (Bearish_MSB for LONG order)
  const getMarketSnapshot = async (symbol) => {
    return {
      autoData: {
        msbState: 'Bearish_MSB',
        vpinValue: 0.05,
        l1: 'Trend',
        ema20: 3000,
        atr14: 50
      },
      apiMacro: { realSpreadPct: 0.05 },
      softScore: 80
    };
  };

  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    readBinanceReq,
    sendBinanceReq,
    supabase,
    getMarketSnapshot
  });

  await service.runLedgerStateSync();

  assert.ok(binanceDeletes.length >= 1);
  assert.equal(binanceDeletes[0].method, 'DELETE');
  assert.equal(binanceDeletes[0].params.symbol, 'ETHUSDT');

  assert.equal(supabase.updateCalls.length, 1);
  assert.equal(supabase.updateCalls[0].id, 'trade-invalidated-1');
  assert.equal(supabase.updateCalls[0].payload.status, 'CANCELLED_INVALIDATED');
  assert.ok(supabase.updateCalls[0].payload.exit_reason.includes('HARD_GATE_FAILED_H_MSB'));
  assert.ok(supabase.updateCalls[0].payload.close_time);
});

test('ledgerSyncService - Binance error -2011 (UNKNOWN_ORDER) is ignored safely', async () => {
  const expiredTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const initialLogs = [
    {
      id: 'trade-error-2011',
      symbol: 'SOLUSDT',
      direction: 'LONG',
      status: 'PENDING',
      type: 'FUTURES',
      entry: 100,
      sl: 95,
      interval: '15m',
      created_at: expiredTimestamp
    }
  ];

  const supabase = createMockSupabase(initialLogs);

  const readBinanceReq = async () => [{ symbol: 'SOLUSDT', positionAmt: '0' }];
  const sendBinanceReq = async () => {
    const error = new Error('Unknown order sent');
    error.code = -2011;
    throw error;
  };

  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    readBinanceReq,
    sendBinanceReq,
    supabase
  });

  // Should not throw error
  await service.runLedgerStateSync();

  assert.equal(supabase.updateCalls.length, 1);
  assert.equal(supabase.updateCalls[0].payload.status, 'CANCELLED_EXPIRED');
});

test('ledgerSyncService - Valid non-expired PENDING order remains PENDING', async () => {
  const recentTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const initialLogs = [
    {
      id: 'trade-valid-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      status: 'PENDING',
      type: 'FUTURES',
      entry: 50000,
      sl: 49000,
      interval: '15m',
      strategy_name: 'VOL_COMPRESSION_IGNITION',
      soft_score: 80,
      atr_at_entry: 500,
      created_at: recentTimestamp
    }
  ];

  const supabase = createMockSupabase(initialLogs);
  const binanceDeletes = [];

  const readBinanceReq = async () => [{ symbol: 'BTCUSDT', positionAmt: '0' }];
  const sendBinanceReq = async (method, endpoint, params) => {
    binanceDeletes.push({ method, endpoint, params });
  };

  const getMarketSnapshot = async () => ({
    autoData: {
      msbState: 'Bullish_MSB',
      vpinValue: 0.05,
      l1: 'Trend',
      ema20: 50000,
      atr14: 500
    },
    apiMacro: { realSpreadPct: 0.05 },
    softScore: 80
  });

  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    readBinanceReq,
    sendBinanceReq,
    supabase,
    getMarketSnapshot
  });

  await service.runLedgerStateSync();

  assert.equal(binanceDeletes.length, 0);
  assert.equal(supabase.updateCalls.length, 0);
  assert.equal(supabase.logs[0].status, 'PENDING');
});

test('ledgerSyncService - PENDING order remains PENDING when marketDataCache is passed but snapshot is null (not ready)', async () => {
  const recentTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const initialLogs = [
    {
      id: 'trade-cache-null-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      status: 'PENDING',
      type: 'FUTURES',
      entry: 50000,
      sl: 49000,
      interval: '15m',
      strategy_name: 'VOL_COMPRESSION_IGNITION',
      soft_score: 80,
      atr_at_entry: 500,
      created_at: recentTimestamp
    }
  ];

  const supabase = createMockSupabase(initialLogs);
  const binanceDeletes = [];

  const readBinanceReq = async () => [{ symbol: 'BTCUSDT', positionAmt: '0' }];
  const sendBinanceReq = async (method, endpoint, params) => {
    binanceDeletes.push({ method, endpoint, params });
  };

  const marketDataCache = {
    getKlines: async () => null,
    getSnapshot: async () => null
  };

  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    marketDataCache,
    readBinanceReq,
    sendBinanceReq,
    supabase
  });

  await service.runLedgerStateSync();

  assert.equal(binanceDeletes.length, 0);
  assert.equal(supabase.updateCalls.length, 0);
  assert.equal(supabase.logs[0].status, 'PENDING');
});

test('ledgerSyncService - PENDING order integrates with marketDataCache.getKlines to build snapshot', async () => {
  const recentTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const initialLogs = [
    {
      id: 'trade-cache-klines-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      status: 'PENDING',
      type: 'FUTURES',
      entry: 50000,
      sl: 49000,
      interval: '15m',
      strategy_name: 'VOL_COMPRESSION_IGNITION',
      soft_score: 80,
      atr_at_entry: 500,
      created_at: recentTimestamp
    }
  ];

  const supabase = createMockSupabase(initialLogs);
  const binanceDeletes = [];

  const readBinanceReq = async () => [{ symbol: 'BTCUSDT', positionAmt: '0' }];
  const sendBinanceReq = async (method, endpoint, params) => {
    binanceDeletes.push({ method, endpoint, params });
  };

  const dummyKlines = Array.from({ length: 25 }, (_, i) => [
    Date.now() - (25 - i) * 15 * 60 * 1000,
    '50000',
    '50250',
    '49750',
    '50000',
    '100',
    Date.now() - (25 - i) * 15 * 60 * 1000 + 14 * 60 * 1000,
    '5000000',
    10,
    '50',
    '2500000',
    '0'
  ]);

  let getKlinesCalled = false;
  const marketDataCache = {
    getKlines: async (symbol, interval) => {
      getKlinesCalled = true;
      assert.equal(symbol, 'BTCUSDT');
      assert.equal(interval, '15m');
      return dummyKlines;
    },
    getBookTicker: () => ({ bidPrice: '49999', askPrice: '50001' })
  };

  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    marketDataCache,
    readBinanceReq,
    sendBinanceReq,
    supabase
  });

  await service.runLedgerStateSync();

  assert.equal(getKlinesCalled, true);
  assert.equal(binanceDeletes.length, 0);
  assert.equal(supabase.updateCalls.length, 0);
  assert.equal(supabase.logs[0].status, 'PENDING');
});

test('ledgerSyncService - PENDING order integrates with marketDataCache.getSnapshot method', async () => {
  const recentTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const initialLogs = [
    {
      id: 'trade-cache-snapshot-1',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      status: 'PENDING',
      type: 'FUTURES',
      entry: 3000,
      sl: 2900,
      interval: '15m',
      strategy_name: 'VOL_COMPRESSION_IGNITION',
      soft_score: 80,
      atr_at_entry: 50,
      created_at: recentTimestamp
    }
  ];

  const supabase = createMockSupabase(initialLogs);
  const binanceDeletes = [];

  const readBinanceReq = async () => [{ symbol: 'ETHUSDT', positionAmt: '0' }];
  const sendBinanceReq = async (method, endpoint, params) => {
    binanceDeletes.push({ method, endpoint, params });
    return { data: { code: 200, msg: 'Success' } };
  };

  let getSnapshotCalled = false;
  const marketDataCache = {
    getSnapshot: async (symbol, interval) => {
      getSnapshotCalled = true;
      assert.equal(symbol, 'ETHUSDT');
      assert.equal(interval, '15m');
      return {
        autoData: {
          msbState: 'Bearish_MSB',
          vpinValue: 0.05,
          l1: 'Trend',
          ema20: 3000,
          atr14: 50
        },
        apiMacro: { realSpreadPct: 0.05 },
        softScore: 80
      };
    }
  };

  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    marketDataCache,
    readBinanceReq,
    sendBinanceReq,
    supabase
  });

  await service.runLedgerStateSync();

  assert.equal(getSnapshotCalled, true);
  assert.ok(binanceDeletes.length >= 1);
  assert.equal(supabase.updateCalls[0].payload.status, 'CANCELLED_INVALIDATED');
});

test('ledgerSyncService - PENDING order remains PENDING when marketDataCache is omitted entirely', async () => {
  const recentTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const initialLogs = [
    {
      id: 'trade-omitted-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      status: 'PENDING',
      type: 'FUTURES',
      entry: 50000,
      sl: 49000,
      interval: '15m',
      strategy_name: 'VOL_COMPRESSION_IGNITION',
      soft_score: 80,
      atr_at_entry: 500,
      created_at: recentTimestamp
    }
  ];

  const supabase = createMockSupabase(initialLogs);
  const binanceDeletes = [];

  const readBinanceReq = async () => [{ symbol: 'BTCUSDT', positionAmt: '0' }];
  const sendBinanceReq = async (method, endpoint, params) => {
    binanceDeletes.push({ method, endpoint, params });
  };

  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    readBinanceReq,
    sendBinanceReq,
    supabase
  });

  await service.runLedgerStateSync();

  assert.equal(binanceDeletes.length, 0);
  assert.equal(supabase.updateCalls.length, 0);
  assert.equal(supabase.logs[0].status, 'PENDING');
});

test('ledgerSyncService - resolved trades persist close timestamps for PEE', async () => {
  const openedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const initialLogs = [{
    id: 'closed-trade-1',
    symbol: 'LPTUSDT',
    direction: 'LONG',
    status: 'OPEN',
    type: 'FUTURES',
    entry: 100,
    sl: 95,
    tp_1_price: 110,
    position_size_usd: 100,
    interval: '1h',
    holding_cycles: 6,
    planned_holding_cycles: 6,
    opened_at: openedAt,
    created_at: openedAt,
    sl_algo_id: 11,
    tp_algo_id: 12
  }];
  const supabase = createMockSupabase(initialLogs);
  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    readBinanceReq: async endpoint => {
      if (endpoint === '/fapi/v2/positionRisk') {
        return [{ symbol: 'LPTUSDT', positionAmt: '0' }];
      }
      if (endpoint === '/fapi/v1/userTrades') {
        return [{
          symbol: 'LPTUSDT',
          time: Date.now(),
          realizedPnl: '5'
        }];
      }
      return [];
    },
    sendBinanceReq: async () => ({ data: { code: 200 } }),
    supabase
  });

  await service.runLedgerStateSync();

  const resolved = supabase.updateCalls.at(-1).payload;
  assert.equal(resolved.status, 'WIN');
  assert.ok(resolved.close_time);
  assert.equal(resolved.pee_analyzed, false);
  assert.equal(resolved.actual_holding_cycles, 1);
  assert.equal(Object.hasOwn(resolved, 'holding_cycles'), false);
  assert.equal(resolved.metric_version, 'live-ledger-excursion/v2');
});

test('resolveExitReason infers SL or TP hit when algoCleanup has code -2011', () => {
  const log = {
    symbol: 'ONDOUSDT',
    direction: 'LONG',
    sl_algo_id: '1001',
    tp_algo_id: '1002'
  };

  const reasonSl = resolveExitReason(
    log,
    null,
    {},
    {
      cancelled: [{ kind: 'tp', algoId: '1002' }],
      failed: [{ kind: 'sl', algoId: '1001', code: -2011, message: 'Unknown order sent' }]
    }
  );
  assert.equal(reasonSl, 'STOP_LOSS_HIT');

  const reasonTp = resolveExitReason(
    log,
    null,
    {},
    {
      cancelled: [{ kind: 'sl', algoId: '1001' }],
      failed: [{ kind: 'tp', algoId: '1002', code: -2011, message: 'Unknown order sent' }]
    }
  );
  assert.equal(reasonTp, 'TAKE_PROFIT_HIT');
});

test('ledgerSyncService resolves zero PnL trade as LOSS when exitReason is STOP_LOSS_HIT', async () => {
  const openedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const initialLogs = [{
    id: 'trade-ondo-loss',
    symbol: 'ONDOUSDT',
    direction: 'LONG',
    status: 'OPEN',
    type: 'FUTURES',
    entry: 0.85,
    sl: 0.82,
    tp_1_price: 0.95,
    position_size_usd: 100,
    interval: '15m',
    opened_at: openedAt,
    created_at: openedAt,
    sl_algo_id: 1051,
    tp_algo_id: 1169
  }];
  const supabase = createMockSupabase(initialLogs);
  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    readBinanceReq: async endpoint => {
      if (endpoint === '/fapi/v2/positionRisk') {
        return [{ symbol: 'ONDOUSDT', positionAmt: '0' }];
      }
      return [];
    },
    sendBinanceReq: async (method, endpoint, params) => {
      if (params?.algoId === 1051 || params?.algoId === '1051') {
        const err = new Error('Unknown order sent.');
        err.response = { data: { code: -2011, msg: 'Unknown order sent.' } };
        throw err;
      }
      return { code: 200 };
    },
    supabase
  });

  await service.runLedgerStateSync();

  const resolved = supabase.updateCalls.at(-1).payload;
  assert.equal(resolved.status, 'LOSS');
  assert.equal(resolved.exit_reason, 'STOP_LOSS_HIT');
  assert.ok(resolved.pnl_usd < 0);
  assert.ok(Math.abs(resolved.pnl_usd - (-3.5294)) < 1e-3);
});

function makeKline(index, takerBuyBase) {
  const baseTime = Date.now() - (80 - index) * 15 * 60 * 1000;
  return [
    baseTime,
    '3000',
    '3002',
    '2998',
    '3000',
    '100',
    baseTime + 14 * 60 * 1000,
    '300000',
    10,
    String(takerBuyBase),
    String(takerBuyBase * 3),
    '0'
  ];
}

test('ledgerSyncService - real VPIN from klines (high taker-buy) invalidates the PENDING order', async () => {
  const recentTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const initialLogs = [
    {
      id: 'trade-vpin-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      status: 'PENDING',
      type: 'FUTURES',
      entry: 3000,
      sl: 2900,
      interval: '15m',
      strategy_name: 'VOL_COMPRESSION_IGNITION',
      soft_score: 80,
      atr_at_entry: 4,
      created_at: recentTimestamp
    }
  ];

  const supabase = createMockSupabase(initialLogs);
  const binanceDeletes = [];

  const readBinanceReq = async () => [{ symbol: 'BTCUSDT', positionAmt: '0' }];
  const sendBinanceReq = async (method, endpoint, params) => {
    binanceDeletes.push({ method, endpoint, params });
  };

  // 60 klines, taker-buy = 90% of base volume => real VPIN ~ 0.8 (> 0.10 gate)
  const takerBuyKlines = Array.from({ length: 60 }, (_, i) => makeKline(i, 90));
  const marketDataCache = {
    getKlines: async () => takerBuyKlines
  };

  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    marketDataCache,
    readBinanceReq,
    sendBinanceReq,
    supabase
  });

  await service.runLedgerStateSync();

  assert.ok(binanceDeletes.length >= 1);
  assert.equal(binanceDeletes[0].method, 'DELETE');
  assert.equal(binanceDeletes[0].params.symbol, 'BTCUSDT');
  assert.equal(supabase.updateCalls.length, 1);
  assert.equal(supabase.updateCalls[0].id, 'trade-vpin-1');
  assert.equal(supabase.updateCalls[0].payload.status, 'CANCELLED_INVALIDATED');
  assert.ok(supabase.updateCalls[0].payload.exit_reason.includes('HARD_GATE_FAILED_H_VPIN'));
  assert.ok(supabase.updateCalls[0].payload.close_time);
});

test('ledgerSyncService - VPIN returns 0 with fewer than 50 klines (no crash, order stays PENDING)', async () => {
  const recentTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const initialLogs = [
    {
      id: 'trade-vpin-short-1',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      status: 'PENDING',
      type: 'FUTURES',
      entry: 3000,
      sl: 2900,
      interval: '15m',
      strategy_name: 'VOL_COMPRESSION_IGNITION',
      soft_score: 80,
      atr_at_entry: 4,
      created_at: recentTimestamp
    }
  ];

  const supabase = createMockSupabase(initialLogs);
  const binanceDeletes = [];

  const readBinanceReq = async () => [{ symbol: 'ETHUSDT', positionAmt: '0' }];
  const sendBinanceReq = async (method, endpoint, params) => {
    binanceDeletes.push({ method, endpoint, params });
  };

  // 25 klines (< 50 lookback) with extreme taker-buy imbalance:
  // real VPIN must be 0 (fail-open), never NaN/crash.
  const shortKlines = Array.from({ length: 25 }, (_, i) => makeKline(i, 90));
  const marketDataCache = {
    getKlines: async () => shortKlines
  };

  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    marketDataCache,
    readBinanceReq,
    sendBinanceReq,
    supabase
  });

  await service.runLedgerStateSync();

  assert.equal(binanceDeletes.length, 0);
  assert.equal(supabase.updateCalls.length, 0);
  assert.equal(supabase.logs[0].status, 'PENDING');
});

test('ledgerSyncService - snapshot without l1/vpinValue/softScore does not crash the gate policy', async () => {
  const recentTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const initialLogs = [
    {
      id: 'trade-no-l1-1',
      symbol: 'SOLUSDT',
      direction: 'LONG',
      status: 'PENDING',
      type: 'FUTURES',
      entry: 3000,
      sl: 2900,
      interval: '15m',
      strategy_name: 'VOL_COMPRESSION_IGNITION',
      soft_score: 80,
      atr_at_entry: 2,
      created_at: recentTimestamp
    }
  ];

  const supabase = createMockSupabase(initialLogs);
  const binanceDeletes = [];

  const readBinanceReq = async () => [{ symbol: 'SOLUSDT', positionAmt: '0' }];
  const sendBinanceReq = async (method, endpoint, params) => {
    binanceDeletes.push({ method, endpoint, params });
  };

  // Snapshot deliberately omits l1, vpinValue and softScore.
  const marketDataCache = {
    getSnapshot: async () => ({
      autoData: {
        msbState: 'Bullish_MSB',
        ema20: 3000,
        atr14: 2
      },
      apiMacro: { realSpreadPct: 0.05 }
    })
  };

  const service = createLedgerSyncService({
    markPriceCache: new Map(),
    marketDataCache,
    readBinanceReq,
    sendBinanceReq,
    supabase
  });

  await service.runLedgerStateSync();

  assert.equal(binanceDeletes.length, 0);
  assert.equal(supabase.updateCalls.length, 0);
  assert.equal(supabase.logs[0].status, 'PENDING');
});

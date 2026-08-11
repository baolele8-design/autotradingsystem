import assert from 'node:assert/strict';
import test from 'node:test';

import { createProtectionService } from './protectionService.js';

test('persists the verified replacement stop algoId', async () => {
  const now = Date.now();
  const updates = [];
  const trade = {
    id: 'trade-1',
    symbol: 'LPTUSDT',
    direction: 'LONG',
    status: 'OPEN',
    type: 'FUTURES',
    entry: 100,
    sl: 95,
    initial_risk_per_coin: 5,
    opened_at: new Date(now).toISOString(),
    created_at: new Date(now).toISOString(),
    protection_stage: 'NONE',
    high_water_price: 100,
    high_water_r: 0,
    holding_cycles: 10,
    strategy_name: 'ADAPTIVE_LONG_FALLBACK',
    asset_tier: 'Tier 2',
    regime_at_entry: 'Expansion',
    btc_regime_at_entry: 'BULLISH_TREND',
    sl_algo_id: 11
  };
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: [trade], error: null })
        })
      }),
      update: values => ({
        eq: async () => {
          updates.push(values);
          return { error: null };
        }
      })
    })
  };
  const position = {
    symbol: 'LPTUSDT',
    positionAmt: '1',
    entryPrice: '100',
    markPrice: '110',
    positionSide: 'BOTH'
  };
  const oldStop = {
    algoId: 11,
    orderType: 'STOP_MARKET',
    symbol: 'LPTUSDT',
    side: 'SELL',
    triggerPrice: '95',
    clientAlgoId: 'qts-sl-initial'
  };
  const sentRequests = [];
  const readPriorities = [];
  let exchangeInfoPriority;
  const { runSmartTrailingEngine } = createProtectionService({
    getCurrentAiModel: () => ({
      matrix: {
        'ADAPTIVE_LONG_FALLBACK|Tier 2': {
          dynamic_trailing: {
            by_regime: {
              TRENDING: {
                status: 'ACTIVE',
                sample_size: 15,
                optimized: {
                  beTrigger: 0.8,
                  lockTrigger: 1.1,
                  lockAmount: 0.5,
                  trailTrigger: 2.5,
                  trailDist: 1
                },
                by_btc_regime: {
                  BULLISH_TREND: {
                    status: 'ACTIVE',
                    sample_size: 15,
                    optimized: {
                      beTrigger: 0.7,
                      lockTrigger: 1,
                      lockAmount: 0.4,
                      trailTrigger: 2.2,
                      trailDist: 0.9
                    }
                  }
                }
              }
            }
          }
        }
      }
    }),
    markPriceCache: new Map([
      ['LPTUSDT', { price: 110, high: 110, low: 100, updatedAt: now }]
    ]),
    safeFetch: async (_url, options) => {
      exchangeInfoPriority = options?.priority;
      return {
        symbols: [{
          symbol: 'LPTUSDT',
          filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.1' }]
        }]
      };
    },
    readBinanceReq: async (endpoint, _params, options) => {
      readPriorities.push(options?.priority);
      if (endpoint === '/fapi/v2/positionRisk') return [position];
      if (endpoint === '/fapi/v1/openOrders') return [];
      if (endpoint === '/fapi/v1/openAlgoOrders') return [oldStop];
      if (endpoint === '/fapi/v1/algoOrder') {
        return { algoId: 12, algoStatus: 'NEW' };
      }
      throw new Error(`Unexpected read endpoint: ${endpoint}`);
    },
    sendBinanceReq: async (method, endpoint, params) => {
      sentRequests.push({ method, endpoint, params });
      if (method === 'POST' && endpoint === '/fapi/v1/algoOrder') {
        return { data: { algoId: 12 } };
      }
      return { data: {} };
    },
    supabase
  });

  await runSmartTrailingEngine();

  assert.equal(exchangeInfoPriority, 'protection');
  assert.ok(readPriorities.length > 0);
  assert.ok(readPriorities.every(priority => priority === 'protection'));
  assert.ok(sentRequests.some(request =>
    request.method === 'POST' && request.endpoint === '/fapi/v1/algoOrder'
  ));
  assert.ok(sentRequests.some(request =>
    request.method === 'DELETE' &&
    request.endpoint === '/fapi/v1/algoOrder' &&
    request.params.algoId === 11
  ));
  assert.equal(updates.at(-1).sl_algo_id, 12);
  assert.equal(
    sentRequests.find(request =>
      request.method === 'POST' &&
      request.endpoint === '/fapi/v1/algoOrder'
    ).params.triggerPrice,
    '109.0'
  );
});

test('temporal barrier uses immutable planned holding cycles before legacy value', async () => {
  const now = Date.now();
  const trade = {
    id: 'planned-hold-trade',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    status: 'OPEN',
    type: 'FUTURES',
    entry: 100,
    sl: 95,
    initial_risk_per_coin: 5,
    opened_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    protection_stage: 'NONE',
    high_water_price: 100,
    high_water_r: 0,
    holding_cycles: 1,
    planned_holding_cycles: 10,
    interval: '1h',
    strategy_name: 'ADAPTIVE_LONG_FALLBACK',
    asset_tier: 'Tier 1',
    regime_at_entry: 'Range'
  };
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: [trade], error: null })
        })
      }),
      update: () => ({
        eq: async () => ({ error: null })
      })
    })
  };
  const sentRequests = [];
  const { runSmartTrailingEngine } = createProtectionService({
    markPriceCache: new Map([
      ['BTCUSDT', { price: 100, high: 100, low: 100, updatedAt: now }]
    ]),
    safeFetch: async () => ({
      symbols: [{
        symbol: 'BTCUSDT',
        filters: [{
          filterType: 'PRICE_FILTER',
          minPrice: '0',
          tickSize: '0.1'
        }]
      }]
    }),
    readBinanceReq: async endpoint => {
      if (endpoint === '/fapi/v2/positionRisk') {
        return [{
          symbol: 'BTCUSDT',
          positionAmt: '1',
          entryPrice: '100',
          markPrice: '100',
          positionSide: 'BOTH'
        }];
      }
      if (
        endpoint === '/fapi/v1/openOrders' ||
        endpoint === '/fapi/v1/openAlgoOrders'
      ) {
        return [];
      }
      throw new Error(`Unexpected read endpoint: ${endpoint}`);
    },
    sendBinanceReq: async (method, endpoint, params) => {
      sentRequests.push({ endpoint, method, params });
      return { data: {} };
    },
    supabase
  });

  await runSmartTrailingEngine();

  assert.equal(
    sentRequests.some(request =>
      request.method === 'POST' &&
      request.endpoint === '/fapi/v1/order' &&
      request.params.type === 'MARKET'
    ),
    false
  );
});

test('PORTFOLIO_TP: đóng chỉ các vị thế lời khi tổng green >= 14.9; giữ lệnh lỗ/neutral', async () => {
  const now = Date.now();
  const updates = [];
  const tradeAave = {
    id: 'trade-aave', symbol: 'AAVEUSDT', direction: 'SHORT', status: 'OPEN',
    type: 'FUTURES', entry: 100, sl: 110, initial_risk_per_coin: 5,
    opened_at: new Date(now).toISOString(), created_at: new Date(now).toISOString(),
    protection_stage: 'NONE', high_water_price: 100, high_water_r: 0,
    holding_cycles: 10, strategy_name: 'S', asset_tier: 'Tier 2',
    regime_at_entry: 'Expansion', btc_regime_at_entry: 'BULLISH_TREND',
    sl_algo_id: 21, tp_algo_id: 22
  };
  const tradeDot = {
    ...tradeAave, id: 'trade-dot', symbol: 'DOTUSDT', sl_algo_id: 31, tp_algo_id: 32
  };
  const tradeBtc = {
    ...tradeAave, id: 'trade-btc', symbol: 'BTCUSDT', sl_algo_id: 41, tp_algo_id: 42
  };
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: [tradeAave, tradeDot, tradeBtc], error: null })
        })
      }),
      update: values => ({
        eq: async () => {
          updates.push(values);
          return { error: null };
        }
      })
    })
  };
  const positions = [
    { symbol: 'AAVEUSDT', positionAmt: '-1', entryPrice: '100', markPrice: '94', positionSide: 'BOTH', unrealizedProfit: '15.0' },
    { symbol: 'DOTUSDT', positionAmt: '-1', entryPrice: '100', markPrice: '103', positionSide: 'BOTH', unrealizedProfit: '-3.0' },
    { symbol: 'BTCUSDT', positionAmt: '-1', entryPrice: '100', markPrice: '100', positionSide: 'BOTH', unrealizedProfit: '0' }
  ];
  const sentRequests = [];
  const oldStops = [
    { algoId: 21, orderType: 'STOP_MARKET', symbol: 'AAVEUSDT', side: 'BUY', triggerPrice: '110', clientAlgoId: 'qts-sl-initial' },
    { algoId: 22, orderType: 'TAKE_PROFIT_MARKET', symbol: 'AAVEUSDT', side: 'BUY', triggerPrice: '95', clientAlgoId: 'qts-tp-initial' },
    { algoId: 31, orderType: 'STOP_MARKET', symbol: 'DOTUSDT', side: 'BUY', triggerPrice: '110', clientAlgoId: 'qts-sl-initial' },
    { algoId: 41, orderType: 'STOP_MARKET', symbol: 'BTCUSDT', side: 'BUY', triggerPrice: '110', clientAlgoId: 'qts-sl-initial' }
  ];
  const { runSmartTrailingEngine } = createProtectionService({
    getCurrentAiModel: () => null,
    markPriceCache: new Map([
      ['AAVEUSDT', { price: 94, high: 94, low: 100, updatedAt: now }],
      ['DOTUSDT', { price: 103, high: 103, low: 100, updatedAt: now }],
      ['BTCUSDT', { price: 100, high: 100, low: 100, updatedAt: now }]
    ]),
    safeFetch: async () => ({
      symbols: [
        { symbol: 'AAVEUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] },
        { symbol: 'DOTUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] },
        { symbol: 'BTCUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }
      ]
    }),
    readBinanceReq: async endpoint => {
      if (endpoint === '/fapi/v2/positionRisk') return positions;
      if (endpoint === '/fapi/v1/openOrders') return [];
      if (endpoint === '/fapi/v1/openAlgoOrders') return oldStops;
      return [];
    },
    sendBinanceReq: async (method, endpoint, params) => {
      sentRequests.push({ method, endpoint, params });
      return { data: {} };
    },
    supabase
  });

  await runSmartTrailingEngine();

  const closes = sentRequests.filter(r =>
    r.method === 'POST' && r.endpoint === '/fapi/v1/order' && r.params.type === 'MARKET'
  );
  assert.equal(closes.length, 1);
  assert.equal(closes[0].params.symbol, 'AAVEUSDT');
  assert.equal(closes[0].params.side, 'BUY');
  assert.equal(closes[0].params.quantity, 1);

  const closedUpdate = updates.find(u => u.status === 'CLOSED');
  assert.ok(closedUpdate, 'phải ghi CLOSED');
  assert.equal(closedUpdate.exit_reason, 'PORTFOLIO_TP');
  assert.equal(closedUpdate.close_price, 94);
  assert.equal(updates.filter(u => u.status === 'CLOSED').length, 1, 'chỉ 1 lệnh bị đóng');

  const aaveDeletes = sentRequests.filter(r =>
    r.method === 'DELETE' && r.endpoint === '/fapi/v1/algoOrder' &&
    (r.params.algoId === 21 || r.params.algoId === 22)
  );
  assert.equal(aaveDeletes.length, 2, 'hủy SL/TP CO của lệnh đã chốt');
});

test('PORTFOLIO_TP: tổng green < 14.9 thì không đóng gì', async () => {
  const now = Date.now();
  const trade = {
    id: 'trade-low', symbol: 'AAVEUSDT', direction: 'SHORT', status: 'OPEN',
    type: 'FUTURES', entry: 100, sl: 110, initial_risk_per_coin: 5,
    opened_at: new Date(now).toISOString(), created_at: new Date(now).toISOString(),
    protection_stage: 'NONE', high_water_price: 100, high_water_r: 0,
    holding_cycles: 10, strategy_name: 'S', asset_tier: 'Tier 2',
    regime_at_entry: 'Expansion', btc_regime_at_entry: 'BULLISH_TREND'
  };
  const updates = [];
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: async () => ({ data: [trade], error: null }) }) }),
      update: values => ({ eq: async () => { updates.push(values); return { error: null }; } })
    })
  };
  const positions = [
    { symbol: 'AAVEUSDT', positionAmt: '-1', entryPrice: '100', markPrice: '95', positionSide: 'BOTH', unrealizedProfit: '5.0' }
  ];
  const sentRequests = [];
  const { runSmartTrailingEngine } = createProtectionService({
    getCurrentAiModel: () => null,
    markPriceCache: new Map([['AAVEUSDT', { price: 95, high: 95, low: 100, updatedAt: now }]]),
    safeFetch: async () => ({
      symbols: [{ symbol: 'AAVEUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
    }),
    readBinanceReq: async endpoint => {
      if (endpoint === '/fapi/v2/positionRisk') return positions;
      if (endpoint === '/fapi/v1/openOrders') return [];
      if (endpoint === '/fapi/v1/openAlgoOrders') return [];
      return [];
    },
    sendBinanceReq: async (method, endpoint, params) => {
      sentRequests.push({ method, endpoint, params });
      return { data: {} };
    },
    supabase
  });

  await runSmartTrailingEngine();

  const closes = sentRequests.filter(r =>
    r.method === 'POST' && r.endpoint === '/fapi/v1/order' && r.params.type === 'MARKET'
  );
  assert.equal(closes.length, 0);
  assert.equal(updates.some(u => u.status === 'CLOSED'), false);
});

test('PORTFOLIO_TP: không tái xử lý lệnh đã chốt trong cùng cycle (bỏ qua time barrier + không ghi đè exit_reason)', async () => {
  const now = Date.now();
  const updates = [];
  const trade = {
    id: 'trade-aave', symbol: 'AAVEUSDT', direction: 'SHORT', status: 'OPEN',
    type: 'FUTURES', entry: 100, sl: 110, initial_risk_per_coin: 5,
    opened_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    protection_stage: 'NONE', high_water_price: 100, high_water_r: 0,
    holding_cycles: 1, interval: '1h',
    strategy_name: 'S', asset_tier: 'Tier 2',
    regime_at_entry: 'Expansion', btc_regime_at_entry: 'BULLISH_TREND',
    sl_algo_id: 21, tp_algo_id: 22
  };
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: [trade], error: null })
        })
      }),
      update: values => ({
        eq: async () => {
          updates.push(values);
          return { error: null };
        }
      })
    })
  };
  const positions = [
    { symbol: 'AAVEUSDT', positionAmt: '-1', entryPrice: '100', markPrice: '94', positionSide: 'BOTH', unrealizedProfit: '15.0' }
  ];
  const sentRequests = [];
  const oldStops = [
    { algoId: 21, orderType: 'STOP_MARKET', symbol: 'AAVEUSDT', side: 'BUY', triggerPrice: '110', clientAlgoId: 'qts-sl-initial' },
    { algoId: 22, orderType: 'TAKE_PROFIT_MARKET', symbol: 'AAVEUSDT', side: 'BUY', triggerPrice: '95', clientAlgoId: 'qts-tp-initial' }
  ];
  const { runSmartTrailingEngine } = createProtectionService({
    getCurrentAiModel: () => null,
    markPriceCache: new Map([
      ['AAVEUSDT', { price: 94, high: 94, low: 100, updatedAt: now }]
    ]),
    safeFetch: async () => ({
      symbols: [
        { symbol: 'AAVEUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }
      ]
    }),
    readBinanceReq: async endpoint => {
      if (endpoint === '/fapi/v2/positionRisk') return positions;
      if (endpoint === '/fapi/v1/openOrders') return [];
      if (endpoint === '/fapi/v1/openAlgoOrders') return oldStops;
      return [];
    },
    sendBinanceReq: async (method, endpoint, params) => {
      sentRequests.push({ method, endpoint, params });
      return { data: {} };
    },
    supabase
  });

  await runSmartTrailingEngine();

  const closes = sentRequests.filter(r =>
    r.method === 'POST' && r.endpoint === '/fapi/v1/order' && r.params.type === 'MARKET'
  );
  assert.equal(closes.length, 1, 'chỉ 1 MARKET close (portfolio TP), không tái chốt trong cùng cycle');
  assert.equal(closes[0].params.symbol, 'AAVEUSDT');
  assert.equal(closes[0].params.side, 'BUY');

  const closedUpdates = updates.filter(u => u.status === 'CLOSED');
  assert.equal(closedUpdates.length, 1, 'chỉ 1 lần ghi CLOSED');
  assert.equal(closedUpdates[0].exit_reason, 'PORTFOLIO_TP');
  assert.ok(
    !updates.some(u => u.exit_reason === 'TEMPORAL_BARRIER_HIT'),
    'không ghi đè exit_reason bằng TEMPORAL_BARRIER_HIT'
  );
  assert.ok(
    !updates.some(u => u.exit_reason === 'TEMPORAL_BARRIER_PENDING'),
    'không ghi TEMPORAL_BARRIER_PENDING lên lệnh đã chốt portfolio TP'
  );
});

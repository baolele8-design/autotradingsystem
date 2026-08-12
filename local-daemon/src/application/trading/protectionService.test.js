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

// =====================================================================
// BTC BREAK protection (A2/A1) — support/resistance break của BTC
// =====================================================================

const btcKline = (openTime, open, high, low, close, closeTime) => [
  openTime, String(open), String(high), String(low), String(close),
  '0', closeTime, '0', 0, '0', '0', '0'
];

// Chuỗi 25 nến 5m BTC: nến cuối closeTime = anchor - 1000.
function buildBtcSeries(anchor, prices = {}) {
  const interval = 300000;
  const candles = [];
  for (let i = 0; i < 25; i += 1) {
    const openTime = anchor - (25 - i) * interval;
    const p = prices[i] || {};
    const o = p.o ?? 60000;
    const h = p.h ?? o;
    const l = p.l ?? o;
    const c = p.c ?? o;
    candles.push(btcKline(openTime, o, h, l, c, openTime + interval - 1));
  }
  return candles;
}

const btcSupportBreakKlines = now =>
  buildBtcSeries(now - 1000, {
    23: { l: 59950, c: 59950 },
    24: { l: 59950, c: 59950 }
  });

const btcResistanceBreakKlines = now =>
  buildBtcSeries(now - 1000, {
    23: { h: 60050, c: 60050 },
    24: { h: 60050, c: 60050 }
  });

function restoreShadowEnv(prevEnv) {
  if (prevEnv === undefined) delete process.env.BTC_BREAK_SHADOW;
  else process.env.BTC_BREAK_SHADOW = prevEnv;
}

test('BTC BREAK: support break + LONG green (tổng < 14.9) → 1 MARKET close, exit_reason PORTFOLIO_TP_BTC_BREAK, id qts-ex-pbtc-', async () => {
  {
    const now = Date.now();
    const updates = [];
    const trade = {
      id: 'trade-eth', symbol: 'ETHUSDT', direction: 'LONG', status: 'OPEN',
      type: 'FUTURES', entry: 100, sl: 95, initial_risk_per_coin: 5,
      opened_at: new Date(now).toISOString(), created_at: new Date(now).toISOString(),
      protection_stage: 'NONE', high_water_price: 100, high_water_r: 0,
      holding_cycles: 10, strategy_name: 'S', asset_tier: 'Tier 2',
      regime_at_entry: 'Expansion', btc_regime_at_entry: 'BULLISH_TREND'
    };
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: async () => ({ data: [trade], error: null }) }) }),
        update: values => ({ eq: async () => { updates.push(values); return { error: null }; } })
      })
    };
    const positions = [
      { symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '105', positionSide: 'BOTH', unrealizedProfit: '3.0' }
    ];
    const sentRequests = [];
    let klineCall = null;
    const { runSmartTrailingEngine } = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map([['ETHUSDT', { price: 105, high: 105, low: 100, updatedAt: now }]]),
      marketDataCache: {
        getKlines: async (symbol, interval, limit) => {
          klineCall = { symbol, interval, limit };
          return btcSupportBreakKlines(now);
        }
      },
      safeFetch: async () => ({
        symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
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
    assert.equal(closes.length, 1);
    assert.equal(closes[0].params.symbol, 'ETHUSDT');
    assert.equal(closes[0].params.side, 'SELL');
    assert.equal(closes[0].params.quantity, 1);
    assert.equal(closes[0].params.newClientOrderId.startsWith('qts-ex-pbtc-'), true);

    const closedUpdate = updates.find(u => u.status === 'CLOSED');
    assert.ok(closedUpdate, 'phải ghi CLOSED');
    assert.equal(closedUpdate.exit_reason, 'PORTFOLIO_TP_BTC_BREAK');

    assert.equal(klineCall.symbol, 'BTCUSDT');
    assert.equal(klineCall.interval, '5m');
    assert.equal(klineCall.limit, 25);
  }
});

test('BTC BREAK + PORTFOLIO_TP cùng cycle: totalGreen ≥ 14.9 và support break → mỗi symbol đóng đúng 1 lần', async () => {
  {
    const now = Date.now();
    const updates = [];
    const base = {
      status: 'OPEN', type: 'FUTURES', entry: 100, sl: 95, initial_risk_per_coin: 5,
      opened_at: new Date(now).toISOString(), created_at: new Date(now).toISOString(),
      protection_stage: 'NONE', high_water_price: 100, high_water_r: 0,
      holding_cycles: 10, strategy_name: 'S', asset_tier: 'Tier 2',
      regime_at_entry: 'Expansion', btc_regime_at_entry: 'BULLISH_TREND'
    };
    const tradeAave = { ...base, id: 'trade-aave', symbol: 'AAVEUSDT', direction: 'LONG' };
    const tradeEth = { ...base, id: 'trade-eth', symbol: 'ETHUSDT', direction: 'LONG' };
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: async () => ({ data: [tradeAave, tradeEth], error: null }) })
        }),
        update: values => ({ eq: async () => { updates.push(values); return { error: null }; } })
      })
    };
    const positions = [
      { symbol: 'AAVEUSDT', positionAmt: '1', entryPrice: '100', markPrice: '108', positionSide: 'BOTH', unrealizedProfit: '8.0' },
      { symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '107', positionSide: 'BOTH', unrealizedProfit: '7.0' }
    ];
    const sentRequests = [];
    const { runSmartTrailingEngine } = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map([
        ['AAVEUSDT', { price: 108, high: 108, low: 100, updatedAt: now }],
        ['ETHUSDT', { price: 107, high: 107, low: 100, updatedAt: now }]
      ]),
      marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
      safeFetch: async () => ({
        symbols: [
          { symbol: 'AAVEUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] },
          { symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }
        ]
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
    assert.equal(closes.length, 2, 'portfolio TP đóng 2 lệnh; BTC break không đóng lại lần 2');
    const symbols = closes.map(c => c.params.symbol).sort();
    assert.deepEqual(symbols, ['AAVEUSDT', 'ETHUSDT']);

    const closedUpdates = updates.filter(u => u.status === 'CLOSED');
    assert.equal(closedUpdates.length, 2, 'mỗi lệnh chỉ ghi CLOSED 1 lần');
    assert.ok(closedUpdates.every(u => u.exit_reason === 'PORTFOLIO_TP'));
  }
});

test('BTC BREAK live mặc định (không cần env BTC_BREAK_SHADOW): support break + LONG green → 1 MARKET close, exit_reason PORTFOLIO_TP_BTC_BREAK', async () => {
  const prevEnv = process.env.BTC_BREAK_SHADOW;
  delete process.env.BTC_BREAK_SHADOW;
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const now = Date.now();
    const updates = [];
    const trade = {
      id: 'trade-eth', symbol: 'ETHUSDT', direction: 'LONG', status: 'OPEN',
      type: 'FUTURES', entry: 100, sl: 95, initial_risk_per_coin: 5,
      opened_at: new Date(now).toISOString(), created_at: new Date(now).toISOString(),
      protection_stage: 'NONE', high_water_price: 100, high_water_r: 0,
      holding_cycles: 10, strategy_name: 'S', asset_tier: 'Tier 2',
      regime_at_entry: 'Expansion', btc_regime_at_entry: 'BULLISH_TREND'
    };
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: async () => ({ data: [trade], error: null }) }) }),
        update: values => ({ eq: async () => { updates.push(values); return { error: null }; } })
      })
    };
    const positions = [
      { symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '105', positionSide: 'BOTH', unrealizedProfit: '3.0' }
    ];
    const sentRequests = [];
    const { runSmartTrailingEngine } = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map([['ETHUSDT', { price: 105, high: 105, low: 100, updatedAt: now }]]),
      marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
      safeFetch: async () => ({
        symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
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
    assert.equal(closes.length, 1, 'live mặc định (không cần env): vẫn đóng lệnh thật');
    assert.equal(closes[0].params.symbol, 'ETHUSDT');
    assert.equal(closes[0].params.side, 'SELL');
    assert.equal(closes[0].params.newClientOrderId.startsWith('qts-ex-pbtc-'), true);

    const closedUpdate = updates.find(u => u.status === 'CLOSED');
    assert.ok(closedUpdate, 'phải ghi CLOSED');
    assert.equal(closedUpdate.exit_reason, 'PORTFOLIO_TP_BTC_BREAK');
    assert.ok(logs.some(l => l.includes('[BTC BREAK]')), 'phải log [BTC BREAK] đóng thật');
    assert.equal(logs.some(l => l.includes('[BTC BREAK SHADOW]')), false, 'không còn log shadow');
  } finally {
    console.log = originalLog;
    restoreShadowEnv(prevEnv);
  }
});

test('BTC BREAK resistance break: chỉ đóng SHORT green, LONG green không đụng', async () => {
  {
    const now = Date.now();
    const updates = [];
    const base = {
      status: 'OPEN', type: 'FUTURES', entry: 100, sl: 105, initial_risk_per_coin: 5,
      opened_at: new Date(now).toISOString(), created_at: new Date(now).toISOString(),
      protection_stage: 'NONE', high_water_price: 100, high_water_r: 0,
      holding_cycles: 10, strategy_name: 'S', asset_tier: 'Tier 2',
      regime_at_entry: 'Expansion', btc_regime_at_entry: 'BULLISH_TREND'
    };
    const tradeAave = { ...base, id: 'trade-aave', symbol: 'AAVEUSDT', direction: 'SHORT' };
    const tradeEth = { ...base, id: 'trade-eth', symbol: 'ETHUSDT', direction: 'LONG' };
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: async () => ({ data: [tradeAave, tradeEth], error: null }) })
        }),
        update: values => ({ eq: async () => { updates.push(values); return { error: null }; } })
      })
    };
    const positions = [
      { symbol: 'AAVEUSDT', positionAmt: '-1', entryPrice: '100', markPrice: '95', positionSide: 'BOTH', unrealizedProfit: '5.0' },
      { symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '104', positionSide: 'BOTH', unrealizedProfit: '4.0' }
    ];
    const sentRequests = [];
    const { runSmartTrailingEngine } = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map([
        ['AAVEUSDT', { price: 95, high: 100, low: 95, updatedAt: now }],
        ['ETHUSDT', { price: 104, high: 104, low: 100, updatedAt: now }]
      ]),
      marketDataCache: { getKlines: async () => btcResistanceBreakKlines(now) },
      safeFetch: async () => ({
        symbols: [
          { symbol: 'AAVEUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] },
          { symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }
        ]
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
    assert.equal(closes.length, 1, 'chỉ SHORT green bị đóng');
    assert.equal(closes[0].params.symbol, 'AAVEUSDT');
    assert.equal(closes[0].params.side, 'BUY');
    assert.equal(closes[0].params.newClientOrderId.startsWith('qts-ex-pbtc-'), true);

    const closedUpdates = updates.filter(u => u.status === 'CLOSED');
    assert.equal(closedUpdates.length, 1);
    assert.equal(closedUpdates[0].exit_reason, 'PORTFOLIO_TP_BTC_BREAK');
  }
});

test('BTC BREAK: cooldown 4h chặn cycle 2; burst giới hạn 3 symbols; fail-closed khi getKlines throw hoặc thiếu marketDataCache', async () => {
  {
    const now = Date.now();
    const updates = [];
    const base = {
      status: 'OPEN', type: 'FUTURES', entry: 100, sl: 100, initial_risk_per_coin: 5,
      opened_at: new Date(now).toISOString(), created_at: new Date(now).toISOString(),
      protection_stage: 'NONE', high_water_price: 100, high_water_r: 0,
      holding_cycles: 10, strategy_name: 'S', asset_tier: 'Tier 2',
      regime_at_entry: 'Expansion', btc_regime_at_entry: 'BULLISH_TREND'
    };
    const tradeEth = { ...base, id: 'trade-eth', symbol: 'ETHUSDT', direction: 'LONG' };
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: async () => ({ data: [tradeEth], error: null }) }) }),
        update: values => ({ eq: async () => { updates.push(values); return { error: null }; } })
      })
    };
    const positions = [
      { symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '100', positionSide: 'BOTH', unrealizedProfit: '3.0' }
    ];
    const sentRequests = [];
    const { runSmartTrailingEngine } = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map([['ETHUSDT', { price: 100, high: 100, low: 100, updatedAt: now }]]),
      marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
      safeFetch: async () => ({
        symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
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
    assert.equal(
      sentRequests.filter(r => r.method === 'POST' && r.endpoint === '/fapi/v1/order').length,
      1,
      'cycle 1: 1 MARKET close'
    );

    sentRequests.length = 0;
    await runSmartTrailingEngine();
    assert.equal(
      sentRequests.filter(r => r.method === 'POST' && r.endpoint === '/fapi/v1/order').length,
      0,
      'cycle 2 trong 4h: cooldown chặn, không đóng'
    );

    // (b) burst: 5 green LONG cùng support break → chỉ 3 symbols đóng
    const symbols5 = ['SOLUSDT', 'DOGEUSDT', 'ADAUSDT', 'XRPUSDT', 'LINKUSDT'];
    const trades5 = symbols5.map((symbol, i) => ({
      ...base,
      id: `trade-${i}`,
      symbol,
      direction: 'LONG'
    }));
    const positions5 = symbols5.map(symbol => ({
      symbol,
      positionAmt: '1',
      entryPrice: '100',
      markPrice: '100',
      positionSide: 'BOTH',
      unrealizedProfit: '1.0'
    }));
    const updates5 = [];
    const sent5 = [];
    const service5 = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map(symbols5.map(s => [s, { price: 100, high: 100, low: 100, updatedAt: now }])),
      marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
      safeFetch: async () => ({
        symbols: symbols5.map(s => ({ symbol: s, filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }))
      }),
      readBinanceReq: async endpoint => {
        if (endpoint === '/fapi/v2/positionRisk') return positions5;
        if (endpoint === '/fapi/v1/openOrders') return [];
        if (endpoint === '/fapi/v1/openAlgoOrders') return [];
        return [];
      },
      sendBinanceReq: async (method, endpoint, params) => {
        sent5.push({ method, endpoint, params });
        return { data: {} };
      },
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({ eq: async () => ({ data: trades5, error: null }) })
          }),
          update: values => ({ eq: async () => { updates5.push(values); return { error: null }; } })
        })
      }
    });

    await service5.runSmartTrailingEngine();

    const closes5 = sent5.filter(r =>
      r.method === 'POST' && r.endpoint === '/fapi/v1/order' && r.params.type === 'MARKET'
    );
    assert.equal(closes5.length, 3, 'burst giới hạn 3 symbols/cycle');
    const closed5 = updates5.filter(u => u.status === 'CLOSED');
    assert.equal(closed5.length, 3);
    assert.ok(closed5.every(u => u.exit_reason === 'PORTFOLIO_TP_BTC_BREAK'));

    // (c) fail-closed: getKlines throw → 0 đóng, không crash
    const sentC = [];
    const updatesC = [];
    const serviceThrow = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map([['ETHUSDT', { price: 100, high: 100, low: 100, updatedAt: now }]]),
      marketDataCache: {
        getKlines: async () => {
          throw new Error('binance down');
        }
      },
      safeFetch: async () => ({
        symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
      }),
      readBinanceReq: async endpoint => {
        if (endpoint === '/fapi/v2/positionRisk') return positions;
        if (endpoint === '/fapi/v1/openOrders') return [];
        if (endpoint === '/fapi/v1/openAlgoOrders') return [];
        return [];
      },
      sendBinanceReq: async (method, endpoint, params) => {
        sentC.push({ method, endpoint, params });
        return { data: {} };
      },
      supabase: {
        from: () => ({
          select: () => ({ eq: () => ({ eq: async () => ({ data: [tradeEth], error: null }) }) }),
          update: values => ({ eq: async () => { updatesC.push(values); return { error: null }; } })
        })
      }
    });

    await serviceThrow.runSmartTrailingEngine();
    assert.equal(
      sentC.filter(r => r.method === 'POST' && r.endpoint === '/fapi/v1/order').length,
      0,
      'getKlines throw → fail-closed, không đóng'
    );
    assert.equal(updatesC.some(u => u.status === 'CLOSED'), false);

    // (c2) fail-closed: thiếu marketDataCache (mặc định null) → 0 đóng, không crash
    const sentNoCache = [];
    const serviceNoCache = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map([['ETHUSDT', { price: 100, high: 100, low: 100, updatedAt: now }]]),
      safeFetch: async () => ({
        symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
      }),
      readBinanceReq: async endpoint => {
        if (endpoint === '/fapi/v2/positionRisk') return positions;
        if (endpoint === '/fapi/v1/openOrders') return [];
        if (endpoint === '/fapi/v1/openAlgoOrders') return [];
        return [];
      },
      sendBinanceReq: async (method, endpoint, params) => {
        sentNoCache.push({ method, endpoint, params });
        return { data: {} };
      },
      supabase: {
        from: () => ({
          select: () => ({ eq: () => ({ eq: async () => ({ data: [tradeEth], error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) })
        })
      }
    });

    await serviceNoCache.runSmartTrailingEngine();
    assert.equal(
      sentNoCache.filter(r => r.method === 'POST' && r.endpoint === '/fapi/v1/order').length,
      0,
      'thiếu marketDataCache → fail-closed, không đóng'
    );
  }
});

// =====================================================================
// F-D3: BTC BREAK red-cap — nhánh vị thế ĐỎ: cap SL về 1R khi BTC break
// (không đóng; không đụng status/exit_reason/protection_stage)
// =====================================================================

function redCapTrade(overrides = {}) {
  return {
    id: 'trade-red', symbol: 'ETHUSDT', direction: 'LONG', status: 'OPEN',
    type: 'FUTURES', entry: 100, sl: 92.5, initial_risk_per_coin: 5,
    protection_stage: 'NONE', high_water_price: 100, high_water_r: 0,
    holding_cycles: 10, strategy_name: 'S', asset_tier: 'Tier 2',
    regime_at_entry: 'Expansion', btc_regime_at_entry: 'BULLISH_TREND',
    sl_algo_id: 52,
    ...overrides
  };
}

test('BTC BREAK CAP: red LONG + support break → SL về entry−1R, SL cũ cancel, persist {sl, sl_algo_id}, status/exit_reason không đổi', async () => {
  const now = Date.now();
  const updates = [];
  const trade = redCapTrade({
    opened_at: new Date(now).toISOString(),
    created_at: new Date(now).toISOString()
  });
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: async () => ({ data: [trade], error: null }) })
      }),
      update: values => ({
        eq: async (_column, id) => {
          updates.push({ id, values });
          return { error: null };
        }
      })
    })
  };
  const position = {
    symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '96',
    positionSide: 'BOTH', unrealizedProfit: '-4.0'
  };
  const oldStop = {
    algoId: 52, orderType: 'STOP_MARKET', symbol: 'ETHUSDT', side: 'SELL',
    triggerPrice: '92.5', clientAlgoId: 'qts-sl-initial'
  };
  const sentRequests = [];
  const { runSmartTrailingEngine } = createProtectionService({
    getCurrentAiModel: () => null,
    markPriceCache: new Map([['ETHUSDT', { price: 96, high: 96, low: 92.5, updatedAt: now }]]),
    marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
    safeFetch: async () => ({
      symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
    }),
    readBinanceReq: async (endpoint, params) => {
      if (endpoint === '/fapi/v2/positionRisk') return [position];
      if (endpoint === '/fapi/v1/openOrders') return [];
      if (endpoint === '/fapi/v1/openAlgoOrders') return [oldStop];
      if (endpoint === '/fapi/v1/algoOrder') return { algoId: 53, algoStatus: 'NEW' };
      return [];
    },
    sendBinanceReq: async (method, endpoint, params) => {
      sentRequests.push({ method, endpoint, params });
      if (method === 'POST' && endpoint === '/fapi/v1/algoOrder') {
        return { data: { algoId: 53 } };
      }
      return { data: {} };
    },
    supabase
  });

  await runSmartTrailingEngine();

  const newStops = sentRequests.filter(r =>
    r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder'
  );
  assert.equal(newStops.length, 1, '1 SL cap được đặt');
  assert.equal(newStops[0].params.symbol, 'ETHUSDT');
  assert.equal(newStops[0].params.side, 'SELL');
  assert.equal(newStops[0].params.type, 'STOP_MARKET');
  assert.equal(newStops[0].params.triggerPrice, '95.00', 'cap tại entry − 1R = 95');

  const deletes = sentRequests.filter(r =>
    r.method === 'DELETE' && r.endpoint === '/fapi/v1/algoOrder'
  );
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].params.algoId, 52, 'SL cũ bị cancel sau khi SL mới verified');

  assert.deepEqual(
    updates,
    [{ id: 'trade-red', values: { sl: 95, sl_algo_id: 53 } }],
    'chỉ persist sl + sl_algo_id; không đụng status/exit_reason/protection_stage'
  );
});

test('BTC BREAK CAP: red SHORT + resistance break → cap @ entry+1R; red LONG cùng symbol không đụng', async () => {
  const now = Date.now();
  const updates = [];
  const base = {
    status: 'OPEN', type: 'FUTURES', entry: 100, initial_risk_per_coin: 5,
    opened_at: new Date(now).toISOString(), created_at: new Date(now).toISOString(),
    protection_stage: 'NONE', high_water_price: 100, high_water_r: 0,
    holding_cycles: 10, strategy_name: 'S', asset_tier: 'Tier 2',
    regime_at_entry: 'Expansion', btc_regime_at_entry: 'BULLISH_TREND'
  };
  const tradeShort = { ...base, id: 'trade-short', symbol: 'ETHUSDT', direction: 'SHORT', sl: 107.5, sl_algo_id: 62 };
  const tradeLong = { ...base, id: 'trade-long', symbol: 'ETHUSDT', direction: 'LONG', sl: 95, sl_algo_id: 61 };
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: async () => ({ data: [tradeShort, tradeLong], error: null }) })
      }),
      update: values => ({
        eq: async (_column, id) => {
          updates.push({ id, values });
          return { error: null };
        }
      })
    })
  };
  const positions = [
    { symbol: 'ETHUSDT', positionAmt: '-1', entryPrice: '100', markPrice: '104', positionSide: 'SHORT', unrealizedProfit: '-4.0' },
    { symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '99.8', positionSide: 'LONG', unrealizedProfit: '-0.2' }
  ];
  const oldStops = [
    { algoId: 61, orderType: 'STOP_MARKET', symbol: 'ETHUSDT', side: 'SELL', triggerPrice: '95', clientAlgoId: 'qts-sl-initial' },
    { algoId: 62, orderType: 'STOP_MARKET', symbol: 'ETHUSDT', side: 'BUY', triggerPrice: '107.5', clientAlgoId: 'qts-sl-initial' }
  ];
  const sentRequests = [];
  const { runSmartTrailingEngine } = createProtectionService({
    getCurrentAiModel: () => null,
    markPriceCache: new Map([
      ['ETHUSDT', { price: 104, high: 100, low: 104, updatedAt: now }]
    ]),
    marketDataCache: { getKlines: async () => btcResistanceBreakKlines(now) },
    safeFetch: async () => ({
      symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
    }),
    readBinanceReq: async (endpoint, params) => {
      if (endpoint === '/fapi/v2/positionRisk') return positions;
      if (endpoint === '/fapi/v1/openOrders') return [];
      if (endpoint === '/fapi/v1/openAlgoOrders') return oldStops;
      if (endpoint === '/fapi/v1/algoOrder') return { algoId: 63, algoStatus: 'NEW' };
      return [];
    },
    sendBinanceReq: async (method, endpoint, params) => {
      sentRequests.push({ method, endpoint, params });
      if (method === 'POST' && endpoint === '/fapi/v1/algoOrder') {
        return { data: { algoId: 63 } };
      }
      return { data: {} };
    },
    supabase
  });

  await runSmartTrailingEngine();

  const newStops = sentRequests.filter(r =>
    r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder'
  );
  assert.equal(newStops.length, 1, 'chỉ SHORT được cap');
  assert.equal(newStops[0].params.side, 'BUY');
  assert.equal(newStops[0].params.triggerPrice, '105.00', 'cap SHORT tại entry + 1R = 105');

  const deletes = sentRequests.filter(r =>
    r.method === 'DELETE' && r.endpoint === '/fapi/v1/algoOrder'
  );
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].params.algoId, 62, 'chỉ cancel SL cũ của SHORT');
  assert.ok(
    !sentRequests.some(r =>
      r.method === 'DELETE' && r.endpoint === '/fapi/v1/algoOrder' && r.params.algoId === 61
    ),
    'SL cũ của red LONG cùng symbol không bị cancel'
  );

  assert.deepEqual(
    updates,
    [{ id: 'trade-short', values: { sl: 105, sl_algo_id: 63 } }],
    'chỉ persist SL của SHORT; red LONG không đụng'
  );
});

test('BTC BREAK CAP monotonic: SL −0.8R (trong cap) → không dời SL (0 order)', async () => {
  const now = Date.now();
  const updates = [];
  const trade = redCapTrade({
    sl: 96,
    opened_at: new Date(now).toISOString(),
    created_at: new Date(now).toISOString()
  });
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: async () => ({ data: [trade], error: null }) })
      }),
      update: values => ({
        eq: async (_column, id) => {
          updates.push({ id, values });
          return { error: null };
        }
      })
    })
  };
  const position = {
    symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '95.5',
    positionSide: 'BOTH', unrealizedProfit: '-4.5'
  };
  const oldStop = {
    algoId: 52, orderType: 'STOP_MARKET', symbol: 'ETHUSDT', side: 'SELL',
    triggerPrice: '96', clientAlgoId: 'qts-sl-initial'
  };
  const sentRequests = [];
  const { runSmartTrailingEngine } = createProtectionService({
    getCurrentAiModel: () => null,
    markPriceCache: new Map([['ETHUSDT', { price: 95.5, high: 95.5, low: 95.5, updatedAt: now }]]),
    marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
    safeFetch: async () => ({
      symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
    }),
    readBinanceReq: async (endpoint, params) => {
      if (endpoint === '/fapi/v2/positionRisk') return [position];
      if (endpoint === '/fapi/v1/openOrders') return [];
      if (endpoint === '/fapi/v1/openAlgoOrders') return [oldStop];
      if (endpoint === '/fapi/v1/algoOrder') return { algoId: 53, algoStatus: 'NEW' };
      return [];
    },
    sendBinanceReq: async (method, endpoint, params) => {
      sentRequests.push({ method, endpoint, params });
      return { data: {} };
    },
    supabase
  });

  await runSmartTrailingEngine();

  assert.equal(
    sentRequests.filter(r =>
      r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder'
    ).length,
    0,
    'SL đã chặt hơn cap → không dời (monotonic)'
  );
  assert.equal(
    sentRequests.filter(r => r.method === 'DELETE').length,
    0,
    'không cancel lệnh nào'
  );
  assert.deepEqual(updates, [], 'không persist gì');
});

test('BTC BREAK CAP [CHỐT 1]: markPriceCache không fresh/thiếu → 0 order + log skip (không fallback position.markPrice)', async () => {
  const now = Date.now();
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => logs.push(args.join(' '));
  try {
    // (a) entry stale > 5s
    const updatesA = [];
    const trade = redCapTrade({
      opened_at: new Date(now).toISOString(),
      created_at: new Date(now).toISOString()
    });
    const position = {
      symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '96',
      positionSide: 'BOTH', unrealizedProfit: '-4.0'
    };
    const sentA = [];
    const serviceA = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map([
        ['ETHUSDT', { price: 96, high: 96, low: 92.5, updatedAt: now - 6000 }]
      ]),
      marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
      safeFetch: async () => ({
        symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
      }),
      readBinanceReq: async (endpoint, params) => {
        if (endpoint === '/fapi/v2/positionRisk') return [position];
        if (endpoint === '/fapi/v1/openOrders') return [];
        if (endpoint === '/fapi/v1/openAlgoOrders') return [];
        return [];
      },
      sendBinanceReq: async (method, endpoint, params) => {
        sentA.push({ method, endpoint, params });
        return { data: {} };
      },
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({ eq: async () => ({ data: [trade], error: null }) })
          }),
          update: values => ({
            eq: async (_column, id) => {
              updatesA.push({ id, values });
              return { error: null };
            }
          })
        })
      }
    });

    await serviceA.runSmartTrailingEngine();
    assert.equal(
      sentA.filter(r => r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder').length,
      0,
      'markPriceCache stale → không cap'
    );
    assert.equal(sentA.filter(r => r.method === 'DELETE').length, 0);
    assert.deepEqual(updatesA, []);
    assert.ok(
      logs.some(l => l.includes('[BTC BREAK CAP SKIP]') && l.includes('ETHUSDT')),
      'phải log skip vì markPriceCache không fresh'
    );

    // (b) thiếu entry markPriceCache hoàn toàn
    logs.length = 0;
    const updatesB = [];
    const sentB = [];
    const serviceB = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map(),
      marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
      safeFetch: async () => ({
        symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
      }),
      readBinanceReq: async (endpoint, params) => {
        if (endpoint === '/fapi/v2/positionRisk') return [position];
        if (endpoint === '/fapi/v1/openOrders') return [];
        if (endpoint === '/fapi/v1/openAlgoOrders') return [];
        return [];
      },
      sendBinanceReq: async (method, endpoint, params) => {
        sentB.push({ method, endpoint, params });
        return { data: {} };
      },
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({ eq: async () => ({ data: [trade], error: null }) })
          }),
          update: values => ({
            eq: async (_column, id) => {
              updatesB.push({ id, values });
              return { error: null };
            }
          })
        })
      }
    });

    await serviceB.runSmartTrailingEngine();
    assert.equal(
      sentB.filter(r => r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder').length,
      0,
      'thiếu markPriceCache entry → không cap'
    );
    assert.deepEqual(updatesB, []);
    assert.ok(
      logs.some(l => l.includes('[BTC BREAK CAP SKIP]') && l.includes('ETHUSDT')),
      'phải log skip khi thiếu markPriceCache'
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('BTC BREAK CAP inadmissible: mark đã vượt cap (−1.2R) → 0 order, giữ SL cũ', async () => {
  const now = Date.now();
  const updates = [];
  const trade = redCapTrade({
    opened_at: new Date(now).toISOString(),
    created_at: new Date(now).toISOString()
  });
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: async () => ({ data: [trade], error: null }) })
      }),
      update: values => ({
        eq: async (_column, id) => {
          updates.push({ id, values });
          return { error: null };
        }
      })
    })
  };
  const position = {
    symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '94',
    positionSide: 'BOTH', unrealizedProfit: '-6.0'
  };
  const sentRequests = [];
  const { runSmartTrailingEngine } = createProtectionService({
    getCurrentAiModel: () => null,
    markPriceCache: new Map([['ETHUSDT', { price: 94, high: 94, low: 92.5, updatedAt: now }]]),
    marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
    safeFetch: async () => ({
      symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
    }),
    readBinanceReq: async (endpoint, params) => {
      if (endpoint === '/fapi/v2/positionRisk') return [position];
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

  assert.equal(
    sentRequests.filter(r => r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder').length,
    0,
    'mark đã vượt cap → không đặt SL sẽ trigger ngay'
  );
  assert.equal(sentRequests.filter(r => r.method === 'DELETE').length, 0);
  assert.deepEqual(updates, []);
});

test('BTC BREAK CAP [CHỐT 2]: cooldown chung — cycle 1 green close + red cap; cycle 2 → 0 mutation; trailing cùng cycle không ghi đè SL (stage NONE)', async () => {
  const now = Date.now();
  const updates = [];
  const tradeA = {
    id: 'trade-a', symbol: 'AAVEUSDT', direction: 'LONG', status: 'OPEN',
    type: 'FUTURES', entry: 100, sl: 95, initial_risk_per_coin: 5,
    opened_at: new Date(now).toISOString(), created_at: new Date(now).toISOString(),
    protection_stage: 'NONE', high_water_price: 100, high_water_r: 0,
    holding_cycles: 10, strategy_name: 'S', asset_tier: 'Tier 2',
    regime_at_entry: 'Expansion', btc_regime_at_entry: 'BULLISH_TREND',
    sl_algo_id: 21, tp_algo_id: 22
  };
  const tradeB = { ...tradeA, id: 'trade-b', symbol: 'ETHUSDT', sl: 92.5, sl_algo_id: 52 };
  let openTrades = [tradeA, tradeB];
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({
            data: openTrades.filter(t => t.status === 'OPEN'),
            error: null
          })
        })
      }),
      update: values => ({
        eq: async (_column, id) => {
          updates.push({ id, values });
          const target = openTrades.find(t => t.id === id);
          if (target) Object.assign(target, values);
          return { error: null };
        }
      })
    })
  };
  const positions = [
    { symbol: 'AAVEUSDT', positionAmt: '1', entryPrice: '100', markPrice: '115', positionSide: 'BOTH', unrealizedProfit: '15.0' },
    { symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '96', positionSide: 'BOTH', unrealizedProfit: '-3.0' }
  ];
  const oldStops = [
    { algoId: 21, orderType: 'STOP_MARKET', symbol: 'AAVEUSDT', side: 'SELL', triggerPrice: '95', clientAlgoId: 'qts-sl-initial' },
    { algoId: 22, orderType: 'TAKE_PROFIT_MARKET', symbol: 'AAVEUSDT', side: 'SELL', triggerPrice: '110', clientAlgoId: 'qts-tp-initial' },
    { algoId: 52, orderType: 'STOP_MARKET', symbol: 'ETHUSDT', side: 'SELL', triggerPrice: '92.5', clientAlgoId: 'qts-sl-initial' }
  ];
  const sentRequests = [];
  const { runSmartTrailingEngine } = createProtectionService({
    getCurrentAiModel: () => null,
    markPriceCache: new Map([
      ['AAVEUSDT', { price: 115, high: 115, low: 100, updatedAt: now }],
      ['ETHUSDT', { price: 96, high: 96, low: 92.5, updatedAt: now }]
    ]),
    marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
    safeFetch: async () => ({
      symbols: [
        { symbol: 'AAVEUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] },
        { symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }
      ]
    }),
    readBinanceReq: async (endpoint, params) => {
      if (endpoint === '/fapi/v2/positionRisk') return positions;
      if (endpoint === '/fapi/v1/openOrders') return [];
      if (endpoint === '/fapi/v1/openAlgoOrders') {
        return oldStops.filter(o => o.symbol === params?.symbol);
      }
      if (endpoint === '/fapi/v1/algoOrder') return { algoId: 53, algoStatus: 'NEW' };
      return [];
    },
    sendBinanceReq: async (method, endpoint, params) => {
      sentRequests.push({ method, endpoint, params });
      if (method === 'POST' && endpoint === '/fapi/v1/algoOrder') {
        return { data: { algoId: 53 } };
      }
      return { data: {} };
    },
    supabase
  });

  await runSmartTrailingEngine();

  const closes1 = sentRequests.filter(r =>
    r.method === 'POST' && r.endpoint === '/fapi/v1/order' && r.params.type === 'MARKET'
  );
  assert.equal(closes1.length, 1, 'cycle 1: green A bị portfolio TP đóng');
  assert.equal(closes1[0].params.symbol, 'AAVEUSDT');

  const caps1 = sentRequests.filter(r =>
    r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder'
  );
  assert.equal(caps1.length, 1, 'cycle 1: red B được cap SL');
  assert.equal(caps1[0].params.symbol, 'ETHUSDT');
  assert.equal(caps1[0].params.triggerPrice, '95.00');
  assert.equal(
    sentRequests.filter(r =>
      r.method === 'DELETE' && r.endpoint === '/fapi/v1/algoOrder' && r.params.algoId === 52
    ).length,
    1,
    'SL cũ của B bị cancel'
  );

  const bUpdates = updates.filter(u => u.id === 'trade-b');
  assert.deepEqual(
    bUpdates,
    [{ id: 'trade-b', values: { sl: 95, sl_algo_id: 53 } }],
    'trailing cùng cycle (stage NONE) không ghi đè SL của B sau cap'
  );
  assert.ok(
    bUpdates.every(u =>
      !('status' in u.values) &&
      !('exit_reason' in u.values) &&
      !('protection_stage' in u.values) &&
      !('trailing_activated' in u.values)
    ),
    'cap không đụng status/exit_reason/protection_stage/trailing_activated'
  );

  // cycle 2: cooldown chung chặn cả close lẫn cap; A đã CLOSED (stateful mock)
  sentRequests.length = 0;
  updates.length = 0;
  await runSmartTrailingEngine();

  assert.equal(
    sentRequests.filter(r => r.method === 'POST' || r.method === 'DELETE').length,
    0,
    'cycle 2 trong cooldown → 0 mutation'
  );
  assert.equal(updates.length, 0, 'cycle 2: không persist gì');
});

test('BTC BREAK CAP gate regression (:314): 0 green + ≥1 red → vẫn fetch klines và cap', async () => {
  const now = Date.now();
  const updates = [];
  const trade = redCapTrade({
    opened_at: new Date(now).toISOString(),
    created_at: new Date(now).toISOString()
  });
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: async () => ({ data: [trade], error: null }) })
      }),
      update: values => ({
        eq: async (_column, id) => {
          updates.push({ id, values });
          return { error: null };
        }
      })
    })
  };
  const position = {
    symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '96',
    positionSide: 'BOTH', unrealizedProfit: '-4.0'
  };
  const oldStop = {
    algoId: 52, orderType: 'STOP_MARKET', symbol: 'ETHUSDT', side: 'SELL',
    triggerPrice: '92.5', clientAlgoId: 'qts-sl-initial'
  };
  const sentRequests = [];
  let klineCall = null;
  const { runSmartTrailingEngine } = createProtectionService({
    getCurrentAiModel: () => null,
    markPriceCache: new Map([['ETHUSDT', { price: 96, high: 96, low: 92.5, updatedAt: now }]]),
    marketDataCache: {
      getKlines: async (symbol, interval, limit) => {
        klineCall = { symbol, interval, limit };
        return btcSupportBreakKlines(now);
      }
    },
    safeFetch: async () => ({
      symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
    }),
    readBinanceReq: async (endpoint, params) => {
      if (endpoint === '/fapi/v2/positionRisk') return [position];
      if (endpoint === '/fapi/v1/openOrders') return [];
      if (endpoint === '/fapi/v1/openAlgoOrders') return [oldStop];
      if (endpoint === '/fapi/v1/algoOrder') return { algoId: 53, algoStatus: 'NEW' };
      return [];
    },
    sendBinanceReq: async (method, endpoint, params) => {
      sentRequests.push({ method, endpoint, params });
      if (method === 'POST' && endpoint === '/fapi/v1/algoOrder') {
        return { data: { algoId: 53 } };
      }
      return { data: {} };
    },
    supabase
  });

  await runSmartTrailingEngine();

  assert.ok(klineCall, 'gate phải cho phép fetch klines khi chỉ có red candidates');
  assert.equal(klineCall.symbol, 'BTCUSDT');
  const caps = sentRequests.filter(r =>
    r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder'
  );
  assert.equal(caps.length, 1, 'red được cap dù 0 green');
  assert.deepEqual(updates, [{ id: 'trade-red', values: { sl: 95, sl_algo_id: 53 } }]);
});

test('BTC BREAK CAP fail-closed: thiếu marketDataCache / getKlines throw / thiếu PRICE_FILTER → 0 order', async () => {
  const now = Date.now();
  const trade = redCapTrade({
    opened_at: new Date(now).toISOString(),
    created_at: new Date(now).toISOString()
  });
  const position = {
    symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '96',
    positionSide: 'BOTH', unrealizedProfit: '-4.0'
  };
  const oldStop = {
    algoId: 52, orderType: 'STOP_MARKET', symbol: 'ETHUSDT', side: 'SELL',
    triggerPrice: '92.5', clientAlgoId: 'qts-sl-initial'
  };
  const commonReads = async (endpoint, params) => {
    if (endpoint === '/fapi/v2/positionRisk') return [position];
    if (endpoint === '/fapi/v1/openOrders') return [];
    if (endpoint === '/fapi/v1/openAlgoOrders') return [oldStop];
    if (endpoint === '/fapi/v1/algoOrder') return { algoId: 53, algoStatus: 'NEW' };
    return [];
  };
  const updates = [];
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: async () => ({ data: [trade], error: null }) })
      }),
      update: values => ({
        eq: async (_column, id) => {
          updates.push({ id, values });
          return { error: null };
        }
      })
    })
  };
  const runCase = (overrides = {}) => {
    const sent = [];
    const { runSmartTrailingEngine: run } = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map([['ETHUSDT', { price: 96, high: 96, low: 92.5, updatedAt: now }]]),
      marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
      safeFetch: async () => ({
        symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
      }),
      readBinanceReq: commonReads,
      sendBinanceReq: async (method, endpoint, params) => {
        sent.push({ method, endpoint, params });
        return { data: {} };
      },
      supabase,
      ...overrides
    });
    return { sent, run };
  };

  // (a) marketDataCache null (mặc định)
  const caseA = runCase({ marketDataCache: null });
  await caseA.run();
  assert.equal(
    caseA.sent.filter(r => r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder').length,
    0,
    'thiếu marketDataCache → không cap'
  );

  // (b) getKlines throw
  const caseB = runCase({
    marketDataCache: {
      getKlines: async () => { throw new Error('binance down'); }
    }
  });
  await caseB.run();
  assert.equal(
    caseB.sent.filter(r => r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder').length,
    0,
    'getKlines throw → fail-closed, không cap'
  );

  // (c) thiếu PRICE_FILTER cho symbol (map vẫn nạp được, chỉ ETHUSDT thiếu)
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const caseC = runCase({
      safeFetch: async () => ({
        symbols: [{ symbol: 'BTCUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
      })
    });
    await caseC.run();
    assert.equal(
      caseC.sent.filter(r => r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder').length,
      0,
      'thiếu PRICE_FILTER → không cap'
    );
    assert.equal(caseC.sent.filter(r => r.method === 'DELETE').length, 0);
    assert.ok(
      logs.some(l => l.includes('[BTC BREAK CAP FAIL-CLOSED]') && l.includes('ETHUSDT')),
      'phải log fail-closed khi thiếu PRICE_FILTER'
    );
  } finally {
    console.error = originalError;
  }
});

test('BTC BREAK CAP burst: 5 red cùng chiều → chỉ 3 được cap (BTC_BREAK_BURST_LIMIT)', async () => {
  const now = Date.now();
  const symbols = ['SOLUSDT', 'DOGEUSDT', 'ADAUSDT', 'XRPUSDT', 'LINKUSDT'];
  const trades = symbols.map((symbol, i) => redCapTrade({
    id: `trade-${i}`,
    symbol,
    sl_algo_id: 50 + i,
    opened_at: new Date(now).toISOString(),
    created_at: new Date(now).toISOString()
  }));
  const positions = symbols.map(symbol => ({
    symbol, positionAmt: '1', entryPrice: '100', markPrice: '96',
    positionSide: 'BOTH', unrealizedProfit: '-1.0'
  }));
  const oldStops = symbols.map((symbol, i) => ({
    algoId: 50 + i, orderType: 'STOP_MARKET', symbol, side: 'SELL',
    triggerPrice: '92.5', clientAlgoId: 'qts-sl-initial'
  }));
  const updates = [];
  const sentRequests = [];
  let nextAlgoId = 100;
  const { runSmartTrailingEngine } = createProtectionService({
    getCurrentAiModel: () => null,
    markPriceCache: new Map(symbols.map(s => [s, { price: 96, high: 96, low: 92.5, updatedAt: now }])),
    marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
    safeFetch: async () => ({
      symbols: symbols.map(s => ({ symbol: s, filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }))
    }),
    readBinanceReq: async (endpoint, params) => {
      if (endpoint === '/fapi/v2/positionRisk') return positions;
      if (endpoint === '/fapi/v1/openOrders') return [];
      if (endpoint === '/fapi/v1/openAlgoOrders') return oldStops;
      if (endpoint === '/fapi/v1/algoOrder') return { algoId: nextAlgoId, algoStatus: 'NEW' };
      return [];
    },
    sendBinanceReq: async (method, endpoint, params) => {
      sentRequests.push({ method, endpoint, params });
      if (method === 'POST' && endpoint === '/fapi/v1/algoOrder') {
        nextAlgoId += 1;
        return { data: { algoId: nextAlgoId } };
      }
      return { data: {} };
    },
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: async () => ({ data: trades, error: null }) })
        }),
        update: values => ({
          eq: async (_column, id) => {
            updates.push({ id, values });
            return { error: null };
          }
        })
      })
    }
  });

  await runSmartTrailingEngine();

  const caps = sentRequests.filter(r =>
    r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder'
  );
  assert.equal(caps.length, 3, 'burst giới hạn 3 red symbols/cycle');
  assert.deepEqual(
    caps.map(c => c.params.symbol),
    symbols.slice(0, 3),
    'chỉ 3 symbols đầu bị cap'
  );

  const deletes = sentRequests.filter(r =>
    r.method === 'DELETE' && r.endpoint === '/fapi/v1/algoOrder'
  );
  assert.equal(deletes.length, 3);
  assert.deepEqual(
    deletes.map(d => d.params.algoId).sort(),
    [50, 51, 52],
    'chỉ cancel SL cũ của 3 symbols được cap'
  );

  const slUpdates = updates.filter(u => 'sl' in u.values);
  assert.equal(slUpdates.length, 3);
  assert.ok(slUpdates.every(u => u.values.sl === 95), 'mỗi SL cap về 95');
  assert.ok(
    !updates.some(u => u.id === 'trade-3' || u.id === 'trade-4'),
    'symbols ngoài burst không bị persist'
  );
});

test('BTC BREAK CAP foreign stop: SL không thuộc engine → skip, không cancel', async () => {
  const now = Date.now();
  const updates = [];
  const trade = redCapTrade({
    sl_algo_id: null,
    opened_at: new Date(now).toISOString(),
    created_at: new Date(now).toISOString()
  });
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: async () => ({ data: [trade], error: null }) })
      }),
      update: values => ({
        eq: async (_column, id) => {
          updates.push({ id, values });
          return { error: null };
        }
      })
    })
  };
  const position = {
    symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100', markPrice: '96',
    positionSide: 'BOTH', unrealizedProfit: '-4.0'
  };
  const foreignStop = {
    algoId: 999, orderType: 'STOP_MARKET', symbol: 'ETHUSDT', side: 'SELL',
    triggerPrice: '92.5', clientAlgoId: 'manual-1'
  };
  const sentRequests = [];
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const { runSmartTrailingEngine } = createProtectionService({
      getCurrentAiModel: () => null,
      markPriceCache: new Map([['ETHUSDT', { price: 96, high: 96, low: 92.5, updatedAt: now }]]),
      marketDataCache: { getKlines: async () => btcSupportBreakKlines(now) },
      safeFetch: async () => ({
        symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.01' }] }]
      }),
      readBinanceReq: async (endpoint, params) => {
        if (endpoint === '/fapi/v2/positionRisk') return [position];
        if (endpoint === '/fapi/v1/openOrders') return [];
        if (endpoint === '/fapi/v1/openAlgoOrders') return [foreignStop];
        if (endpoint === '/fapi/v1/algoOrder') return { algoId: 53, algoStatus: 'NEW' };
        return [];
      },
      sendBinanceReq: async (method, endpoint, params) => {
        sentRequests.push({ method, endpoint, params });
        return { data: {} };
      },
      supabase
    });

    await runSmartTrailingEngine();

    assert.equal(
      sentRequests.filter(r => r.method === 'POST' && r.endpoint === '/fapi/v1/algoOrder').length,
      0,
      'foreign stop → không đặt SL cap mới'
    );
    assert.equal(
      sentRequests.filter(r => r.method === 'DELETE').length,
      0,
      'foreign stop → không cancel lệnh đặt tay'
    );
    assert.deepEqual(updates, [], 'không persist gì');
    assert.ok(
      logs.some(l => l.includes('[BTC BREAK CAP SKIP]') && l.includes('ETHUSDT')),
      'phải log skip vì SL ngoài engine'
    );
  } finally {
    console.log = originalLog;
  }
});

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
  const { runSmartTrailingEngine } = createProtectionService({
    markPriceCache: new Map([
      ['LPTUSDT', { price: 110, high: 110, low: 100, updatedAt: now }]
    ]),
    safeFetch: async () => ({
      symbols: [{
        symbol: 'LPTUSDT',
        filters: [{ filterType: 'PRICE_FILTER', minPrice: '0', tickSize: '0.1' }]
      }]
    }),
    readBinanceReq: async endpoint => {
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

  assert.ok(sentRequests.some(request =>
    request.method === 'POST' && request.endpoint === '/fapi/v1/algoOrder'
  ));
  assert.ok(sentRequests.some(request =>
    request.method === 'DELETE' &&
    request.endpoint === '/fapi/v1/algoOrder' &&
    request.params.algoId === 11
  ));
  assert.equal(updates.at(-1).sl_algo_id, 12);
});

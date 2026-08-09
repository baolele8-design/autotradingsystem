import assert from 'node:assert/strict';
import test from 'node:test';

import { cancelTradeAlgoOrders } from './orderOwnershipService.js';
import { makeInitialClientAlgoId } from '../../domain/orders/trailingOrders.js';

test('cancels missing persisted algo IDs through deterministic trade client IDs', async () => {
  const requests = [];
  const log = {
    id: '62bf63c8-dcc1-4f90-a2ea-123456789012',
    symbol: 'LPTUSDT'
  };

  const result = await cancelTradeAlgoOrders({
    log,
    sendBinanceReq: async (method, endpoint, params) => {
      requests.push({ method, endpoint, params });
      return { data: { code: 200 } };
    }
  });

  assert.deepEqual(requests, [
    {
      method: 'DELETE',
      endpoint: '/fapi/v1/algoOrder',
      params: {
        symbol: 'LPTUSDT',
        clientAlgoId: makeInitialClientAlgoId('sl', log.id)
      }
    },
    {
      method: 'DELETE',
      endpoint: '/fapi/v1/algoOrder',
      params: {
        symbol: 'LPTUSDT',
        clientAlgoId: makeInitialClientAlgoId('tp', log.id)
      }
    }
  ]);
  assert.equal(result.cancelled.length, 2);
  assert.equal(result.failed.length, 0);
});

test('prefers persisted algo IDs and reports cancellation failures', async () => {
  const requests = [];
  const log = {
    id: 'trade-1',
    symbol: 'BTCUSDT',
    sl_algo_id: 11,
    tp_algo_id: 12
  };

  const result = await cancelTradeAlgoOrders({
    log,
    sendBinanceReq: async (method, endpoint, params) => {
      requests.push({ method, endpoint, params });
      if (params.algoId === 11) {
        const error = new Error('Unknown order');
        error.response = { data: { code: -2011, msg: 'Unknown order sent.' } };
        throw error;
      }
      return { data: { code: 200 } };
    }
  });

  assert.deepEqual(
    requests.map(request => request.params),
    [
      { symbol: 'BTCUSDT', algoId: 11 },
      { symbol: 'BTCUSDT', algoId: 12 }
    ]
  );
  assert.equal(result.cancelled.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].code, -2011);
});

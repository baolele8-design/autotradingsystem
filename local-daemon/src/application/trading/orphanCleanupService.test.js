import assert from 'node:assert/strict';
import test from 'node:test';

import { createOrphanCleanupService } from './orphanCleanupService.js';

function makeSupabase(rows, error = null) {
  return {
    from(table) {
      assert.equal(table, 'trade_logs');
      return {
        async select(columns) {
          assert.equal(columns, 'symbol,status,sl_algo_id,tp_algo_id');
          return { data: rows, error };
        }
      };
    }
  };
}

function makeContext({ positions, standardOrders = [], algoOrders, rows }) {
  const deletes = [];
  return {
    deletes,
    service: createOrphanCleanupService({
      async readBinanceReq(endpoint) {
        if (endpoint === '/fapi/v2/positionRisk') return positions;
        if (endpoint === '/fapi/v1/openOrders') return standardOrders;
        if (endpoint === '/fapi/v1/openAlgoOrders') return algoOrders;
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      },
      async sendBinanceReq(method, endpoint, params) {
        deletes.push({ method, endpoint, params });
      },
      supabase: makeSupabase(rows),
      async withSymbolOrderLock(_symbol, callback) {
        return callback();
      }
    })
  };
}

test('removes resolved legacy CO without touching current CO on the same symbol', async () => {
  const order = (algoId, type, clientAlgoId) => ({
    algoId,
    symbol: 'HBARUSDT',
    side: 'BUY',
    type,
    reduceOnly: true,
    clientAlgoId
  });
  const { service, deletes } = makeContext({
    positions: [{ symbol: 'HBARUSDT', positionAmt: '-10' }],
    algoOrders: [
      order(11, 'STOP_MARKET', 'legacy-old-sl'),
      order(12, 'TAKE_PROFIT_MARKET', 'legacy-old-tp'),
      order(21, 'STOP_MARKET', 'legacy-current-sl'),
      order(22, 'TAKE_PROFIT_MARKET', 'legacy-current-tp')
    ],
    rows: [
      {
        symbol: 'HBARUSDT',
        status: 'CANCELED',
        sl_algo_id: 11,
        tp_algo_id: 12
      },
      {
        symbol: 'HBARUSDT',
        status: 'OPEN',
        sl_algo_id: 21,
        tp_algo_id: 22
      }
    ]
  });

  await service.runOrphanCleanupEngine();

  assert.deepEqual(
    deletes.map(item => item.params.algoId),
    [11, 12]
  );
});

test('removes detached legacy CO only when its algoId is recorded in ledger', async () => {
  const { service, deletes } = makeContext({
    positions: [],
    algoOrders: [
      {
        algoId: 31,
        symbol: 'UNIUSDT',
        side: 'SELL',
        type: 'STOP_MARKET',
        reduceOnly: true,
        clientAlgoId: 'legacy-recorded'
      },
      {
        algoId: 32,
        symbol: 'UNIUSDT',
        side: 'SELL',
        type: 'TAKE_PROFIT_MARKET',
        reduceOnly: true,
        clientAlgoId: 'possibly-manual'
      }
    ],
    rows: [{
      symbol: 'UNIUSDT',
      status: 'LOSS',
      sl_algo_id: 31,
      tp_algo_id: null
    }]
  });

  await service.runOrphanCleanupEngine();

  assert.deepEqual(
    deletes.map(item => item.params.algoId),
    [31]
  );
});

test('keeps detached CO while a standard entry is pending', async () => {
  const { service, deletes } = makeContext({
    positions: [],
    standardOrders: [{
      orderId: 99,
      symbol: 'DOTUSDT',
      side: 'SELL',
      type: 'LIMIT',
      reduceOnly: false
    }],
    algoOrders: [{
      algoId: 41,
      symbol: 'DOTUSDT',
      side: 'BUY',
      type: 'STOP_MARKET',
      reduceOnly: true,
      clientAlgoId: 'qts-sl-owned'
    }],
    rows: []
  });

  await service.runOrphanCleanupEngine();

  assert.deepEqual(deletes, []);
});

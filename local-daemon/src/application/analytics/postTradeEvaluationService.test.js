import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculatePeeWindowCandles,
  createPostTradeEvaluationService,
  getPeeWindowBounds
} from './postTradeEvaluationService.js';

function createSupabase(trades) {
  const updates = [];
  const filters = [];
  const query = {
    in: () => query,
    limit: async limit => ({
      data: trades.slice(0, limit),
      error: null
    }),
    not: () => query,
    or: filter => {
      filters.push(filter);
      return query;
    },
    order: () => query
  };
  return {
    updates,
    filters,
    from(table) {
      assert.equal(table, 'trade_logs');
      return {
        select() {
          return query;
        },
        update(values) {
          return {
            eq: async (column, id) => {
              updates.push({ column, id, values });
              return { error: null };
            }
          };
        }
      };
    }
  };
}

test('queues legacy fixed-window PEE rows for policy-version rebuild', async () => {
  const supabase = createSupabase([]);
  const service = createPostTradeEvaluationService({
    safeFetch: async () => [],
    supabase
  });

  await service.runPostTradeEvaluation();

  assert.equal(supabase.filters.length, 1);
  assert.match(
    supabase.filters[0],
    /pee_policy_version\.neq\.pee-window-3c-v2/
  );
  assert.match(supabase.filters[0], /pee_policy_version\.is\.null/);
});

test('evaluates a resolved symbol independently of the current scanner pool', async () => {
  const closeTime = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  const trade = {
    id: 'retired-pool-symbol',
    symbol: 'LPTUSDT',
    interval: '1h',
    direction: 'LONG',
    entry: 100,
    close_price: 105,
    position_size_usd: 100,
    close_time: closeTime,
    planned_holding_cycles: 4
  };
  const supabase = createSupabase([trade]);
  const requestedUrls = [];
  const service = createPostTradeEvaluationService({
    safeFetch: async url => {
      requestedUrls.push(url);
      const startTime = Number(new URL(url).searchParams.get('startTime'));
      return Array.from({ length: 3 }, (_, index) => [
        startTime + index * 60 * 60 * 1000,
        '105',
        String(110 + index / 10),
        String(103 - index / 10),
        '108'
      ]);
    },
    supabase
  });

  await service.runPostTradeEvaluation();

  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /symbol=LPTUSDT/);
  assert.equal(supabase.updates.length, 1);
  assert.equal(supabase.updates[0].id, trade.id);
  assert.equal(supabase.updates[0].values.pee_analyzed, true);
  assert.equal(supabase.updates[0].values.pee_window_candles, 3);
  assert.equal(
    supabase.updates[0].values.pee_policy_version,
    'pee-window-3c-v2'
  );
  assert.ok(supabase.updates[0].values.pee_analyzed_at);
});

test('backfills PEE for legacy trades missing planned_holding_cycles', async () => {
  const closeTime = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  const trade = {
    id: 'legacy-no-planned-cycles',
    symbol: 'OLDUSDT',
    interval: '1h',
    direction: 'LONG',
    entry: 100,
    close_price: 105,
    position_size_usd: 100,
    close_time: closeTime,
    planned_holding_cycles: null
  };
  const supabase = createSupabase([trade]);
  const requestedUrls = [];
  const service = createPostTradeEvaluationService({
    safeFetch: async url => {
      requestedUrls.push(url);
      const startTime = Number(new URL(url).searchParams.get('startTime'));
      return Array.from({ length: 3 }, (_, index) => [
        startTime + index * 60 * 60 * 1000,
        '105',
        '110',
        '100',
        '108'
      ]);
    },
    supabase
  });

  await service.runPostTradeEvaluation();

  assert.equal(requestedUrls.length, 1);
  assert.equal(supabase.updates.length, 1);
  assert.equal(supabase.updates[0].id, trade.id);
  assert.equal(supabase.updates[0].values.pee_window_candles, 3);
  assert.equal(supabase.updates[0].values.pee_policy_version, 'pee-window-3c-v2');
});

test('uses a fixed 3-candle window per trade frame for PEE', () => {
  // Owner directive 2026-08-19: PEE window = 2-3 nến theo khung lệnh,
  // không phụ thuộc holding cycles — kết quả nhanh, backfill được mọi lệnh.
  assert.equal(calculatePeeWindowCandles(), 3);
  assert.equal(calculatePeeWindowCandles(2), 3);
  assert.equal(calculatePeeWindowCandles(8), 3);
  assert.equal(calculatePeeWindowCandles(16), 3);
  assert.equal(calculatePeeWindowCandles(null), 3);
});

test('starts PEE at the first full candle after an intra-candle close', () => {
  const hour = 60 * 60 * 1000;
  const bounds = getPeeWindowBounds(3.5 * hour, hour, 6);

  assert.deepEqual(bounds, {
    endTime: 10 * hour,
    matureAt: 10 * hour,
    startTime: 4 * hour
  });
});

test('does not query Binance with a missing close timestamp', async () => {
  const supabase = createSupabase([{
    id: 'missing-close-time',
    symbol: 'OLDUSDT',
    interval: '1h',
    direction: 'LONG',
    entry: 100,
    close_price: 105,
    position_size_usd: 100,
    close_time: null
  }]);
  let fetchCount = 0;
  const service = createPostTradeEvaluationService({
    safeFetch: async () => {
      fetchCount += 1;
      return [];
    },
    supabase
  });

  await service.runPostTradeEvaluation();

  assert.equal(fetchCount, 0);
  assert.equal(supabase.updates.length, 0);
});

test('does not persist PEE from candles outside the requested post-exit window', async () => {
  const hour = 60 * 60 * 1000;
  const closeTimeMs = Math.floor((Date.now() - 8 * hour) / hour) * hour;
  const trade = {
    id: 'wrong-window',
    symbol: 'BTCUSDT',
    interval: '1h',
    direction: 'LONG',
    entry: 100,
    close_price: 100,
    position_size_usd: 100,
    close_time: new Date(closeTimeMs).toISOString(),
    planned_holding_cycles: 4
  };
  const supabase = createSupabase([trade]);
  const service = createPostTradeEvaluationService({
    safeFetch: async () => Array.from({ length: 6 }, (_, index) => [
      closeTimeMs - (index + 1) * hour,
      '100',
      '110',
      '90',
      '100'
    ]),
    supabase
  });

  await service.runPostTradeEvaluation();

  assert.equal(supabase.updates.length, 0);
});

test('concurrent callers await the same PEE evaluation run', async () => {
  const hour = 60 * 60 * 1000;
  const closeTime = new Date(Date.now() - 8 * hour).toISOString();
  const supabase = createSupabase([{
    id: 'shared-pee',
    symbol: 'ETHUSDT',
    interval: '1h',
    direction: 'LONG',
    entry: 100,
    close_price: 100,
    position_size_usd: 100,
    close_time: closeTime,
    planned_holding_cycles: 4
  }]);
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  let fetchCount = 0;
  const service = createPostTradeEvaluationService({
    safeFetch: async url => {
      fetchCount += 1;
      await gate;
      const startTime = Number(new URL(url).searchParams.get('startTime'));
      return Array.from({ length: 3 }, (_, index) => [
        startTime + index * hour,
        '100',
        '101',
        '99',
        '100'
      ]);
    },
    supabase
  });

  const first = service.runPostTradeEvaluation();
  const second = service.runPostTradeEvaluation();
  release();
  const [firstReport, secondReport] = await Promise.all([first, second]);

  assert.deepEqual(secondReport, firstReport);
  assert.equal(fetchCount, 1);
  assert.equal(supabase.updates.length, 1);
});

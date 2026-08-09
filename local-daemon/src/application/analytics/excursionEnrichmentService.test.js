import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExcursionEnrichmentService
} from './excursionEnrichmentService.js';

function createSupabase(trades) {
  const updates = [];
  const query = {
    in: () => query,
    limit: async limit => ({
      data: trades.slice(0, limit),
      error: null
    }),
    not: () => query,
    or: () => query,
    order: () => query
  };
  return {
    updates,
    from(table) {
      assert.equal(table, 'trade_logs');
      return {
        select: () => query,
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

test('enriches lifecycle MFE/MAE from complete one-minute candles', async () => {
  const minute = 60_000;
  const openedAt = 10.5 * minute;
  const closeTime = 14.5 * minute;
  const supabase = createSupabase([{
    id: 'trade-1',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entry: 100,
    position_size_usd: 1_000,
    opened_at: new Date(openedAt).toISOString(),
    close_time: new Date(closeTime).toISOString(),
    max_favorable_excursion_usd: null,
    max_adverse_excursion_usd: null
  }]);
  const requestedUrls = [];
  const service = createExcursionEnrichmentService({
    batchSize: 5,
    safeFetch: async url => {
      requestedUrls.push(url);
      return [
        [11 * minute, '100', '103', '99', '102'],
        [12 * minute, '102', '105', '98', '104'],
        [13 * minute, '104', '104', '101', '103'],
        // Candle opening at lifecycleEnd must not contaminate the metric.
        [14 * minute, '103', '999', '1', '500']
      ];
    },
    supabase
  });

  const report = await service.runExcursionEnrichment();

  assert.equal(report.enriched, 1);
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /interval=1m/);
  assert.equal(supabase.updates.length, 1);
  assert.deepEqual(supabase.updates[0].values, {
    max_adverse_excursion_usd: -20,
    max_favorable_excursion_usd: 50,
    metric_version: 'binance-1m-lifecycle/v1'
  });
});

test('skips rows with unprovable lifecycle geometry without writing defaults', async () => {
  const supabase = createSupabase([{
    id: 'missing-close',
    symbol: 'OLDUSDT',
    direction: 'SHORT',
    entry: 100,
    position_size_usd: 100,
    opened_at: new Date(0).toISOString(),
    close_time: null
  }]);
  let fetchCount = 0;
  const service = createExcursionEnrichmentService({
    safeFetch: async () => {
      fetchCount += 1;
      return [];
    },
    supabase
  });

  const report = await service.runExcursionEnrichment();

  assert.equal(report.enriched, 0);
  assert.equal(report.skipped, 1);
  assert.equal(fetchCount, 0);
  assert.equal(supabase.updates.length, 0);
});

test('does not persist a partial lifecycle when the request budget is exhausted', async () => {
  const minute = 60_000;
  const supabase = createSupabase([{
    id: 'long-lifecycle',
    symbol: 'ETHUSDT',
    direction: 'LONG',
    entry: 100,
    position_size_usd: 100,
    opened_at: new Date(0.5 * minute).toISOString(),
    close_time: new Date(3_001.5 * minute).toISOString()
  }]);
  const service = createExcursionEnrichmentService({
    maxKlineRequestsPerRun: 1,
    safeFetch: async url => {
      const startTime = Number(new URL(url).searchParams.get('startTime'));
      return Array.from({ length: 1_500 }, (_, index) => [
        startTime + index * minute,
        '100',
        '101',
        '99',
        '100'
      ]);
    },
    supabase
  });

  const report = await service.runExcursionEnrichment();

  assert.equal(report.enriched, 0);
  assert.equal(report.skipped, 1);
  assert.equal(supabase.updates.length, 0);
});

test('concurrent callers await the same enrichment run', async () => {
  const minute = 60_000;
  const supabase = createSupabase([{
    id: 'shared-run',
    symbol: 'SOLUSDT',
    direction: 'LONG',
    entry: 100,
    position_size_usd: 100,
    opened_at: new Date(10.5 * minute).toISOString(),
    close_time: new Date(12.5 * minute).toISOString()
  }]);
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  let fetchCount = 0;
  const service = createExcursionEnrichmentService({
    safeFetch: async url => {
      fetchCount += 1;
      await gate;
      const startTime = Number(new URL(url).searchParams.get('startTime'));
      return [
        [startTime, '100', '101', '99', '100'],
        [startTime + minute, '100', '102', '98', '101']
      ];
    },
    supabase
  });

  const first = service.runExcursionEnrichment();
  const second = service.runExcursionEnrichment();
  release();
  const [firstReport, secondReport] = await Promise.all([first, second]);

  assert.deepEqual(secondReport, firstReport);
  assert.equal(fetchCount, 1);
  assert.equal(supabase.updates.length, 1);
});

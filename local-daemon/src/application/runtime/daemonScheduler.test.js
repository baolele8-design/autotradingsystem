import assert from 'node:assert/strict';
import test from 'node:test';

import { createDaemonScheduler } from './daemonScheduler.js';

test('hourly scheduler retrains conditionally instead of only reloading an old model', async () => {
  const intervals = [];
  const timeouts = [];
  let optimizationCycles = 0;
  const noop = async () => {};
  const { startDaemonServices } = createDaemonScheduler({
    getConnectedClients: () => [],
    matrixScannerLoop: noop,
    runExcursionEnrichment: noop,
    runLazyPaperTrading: noop,
    runLedgerStateSync: noop,
    runOptimizationCycle: async () => {
      optimizationCycles += 1;
    },
    runOrphanCleanupEngine: noop,
    runPostTradeEvaluation: noop,
    runSmartTrailingEngine: noop,
    setIntervalFn: (callback, delay) => {
      intervals.push({ callback, delay });
      return intervals.length;
    },
    setTimeoutFn: (callback, delay) => {
      timeouts.push({ callback, delay });
      return timeouts.length;
    },
    startMarketStreams: () => {},
    syncBinanceTime: noop,
    syncHUD: noop,
    syncMvrv: noop
  });

  startDaemonServices();
  const hourly = intervals.find(interval => interval.delay === 3_600_000);
  assert.ok(hourly);

  await hourly.callback();

  assert.equal(optimizationCycles, 1);
  assert.ok(timeouts.some(timeout => timeout.delay === 300_000));
});


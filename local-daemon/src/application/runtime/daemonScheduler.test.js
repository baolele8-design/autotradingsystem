import assert from 'node:assert/strict';
import test from 'node:test';

import { createDaemonScheduler } from './daemonScheduler.js';
import { SCANNER_CYCLE_MS } from '../strategyHealth/strategyWatchdog.js';

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

function makeHarness(overrides = {}) {
  const intervals = [];
  const timeouts = [];
  const healthLogs = [];
  const noop = async () => {};
  const scheduler = createDaemonScheduler({
    getConnectedClients: () => [],
    matrixScannerLoop: noop,
    runExcursionEnrichment: noop,
    runLazyPaperTrading: noop,
    runLedgerStateSync: noop,
    runOptimizationCycle: noop,
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
    syncMvrv: noop,
    strategyHealthLog: msg => {
      healthLogs.push(msg);
    },
    ...overrides
  });
  return { intervals, timeouts, healthLogs, scheduler };
}

test('strategy watchdog: 5-min (300_000ms) health interval is scheduled', () => {
  const { intervals, scheduler } = makeHarness();
  scheduler.startDaemonServices();
  const healthInterval = intervals.find(interval => interval.delay === 300_000);
  assert.ok(healthInterval, 'expected a 300_000ms health interval');
});

test('strategy watchdog: initial health check runs once after the first scanner cycle', () => {
  const { timeouts, scheduler } = makeHarness();
  scheduler.startDaemonServices();
  assert.ok(
    timeouts.some(timeout => timeout.delay === 5000 + SCANNER_CYCLE_MS),
    'expected an initial health check one scanner cycle after the first scan'
  );
});

test('strategy watchdog: never-fired strategies reported stale via 300s interval callback', async () => {
  const { intervals, healthLogs, scheduler } = makeHarness({
    getKnownStrategyIds: () => ['ALPHA', 'BETA', 'GAMMA']
  });
  const { startDaemonServices, updateLastFired } = scheduler;
  startDaemonServices();

  updateLastFired('ALPHA');
  const healthInterval = intervals.find(interval => interval.delay === 300_000);
  const result = await healthInterval.callback();

  assert.deepEqual(result.stale.map(s => s.strategyId), ['BETA', 'GAMMA']);
  assert.ok(result.stale.every(s => s.status === 'NEVER_FIRED'));
  assert.equal(result.summary, '[STRATEGY STALE] BETA (NEVER_FIRED), GAMMA (NEVER_FIRED)');
  assert.ok(healthLogs.some(msg => msg.startsWith('[STRATEGY HEALTH] stale:')));
});

test('strategy watchdog: all recently-fired strategies => all alive log', async () => {
  const { intervals, healthLogs, scheduler } = makeHarness({
    getKnownStrategyIds: () => ['ALPHA', 'BETA']
  });
  const { startDaemonServices, updateLastFired, runStrategyHealthCheck } = scheduler;
  startDaemonServices();

  updateLastFired('ALPHA');
  updateLastFired('BETA');
  const result = await runStrategyHealthCheck();

  assert.equal(result.stale.length, 0);
  assert.equal(result.summary, '[STRATEGY STALE] none');
  assert.ok(healthLogs.some(msg => msg === '[STRATEGY HEALTH] all alive'));
});

test('strategy watchdog: default empty catalog => all alive (vacuous until boot wiring)', async () => {
  const { scheduler } = makeHarness();
  const { startDaemonServices, runStrategyHealthCheck } = scheduler;
  startDaemonServices();
  const result = await runStrategyHealthCheck();
  assert.deepEqual(result.stale, []);
});


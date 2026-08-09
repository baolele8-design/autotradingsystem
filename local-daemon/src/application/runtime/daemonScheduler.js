import {
  findStaleStrategies as findStaleStrategiesDefault,
  logStaleSummary as logStaleSummaryDefault,
  SCANNER_CYCLE_MS
} from '../strategyHealth/strategyWatchdog.js';

export function createDaemonScheduler(context) {
  const {
    getConnectedClients,
    matrixScannerLoop,
    runLazyPaperTrading,
    runLedgerStateSync,
    runExcursionEnrichment,
    runOrphanCleanupEngine,
    runOptimizationCycle,
    runPostTradeEvaluation,
    runSmartTrailingEngine,
    startMarketStreams,
    syncBinanceTime,
    syncHUD,
    syncMvrv,
    // R3 watchdog context (all optional; defaults keep the scheduler
    // self-contained and testable):
    getKnownStrategyIds = () => [],
    strategyWatchdog = {},
    strategyHealthLog = (...args) => console.log(...args),
    strategyStaleAfterCycles
  } = context;
  const setIntervalFn = context.setIntervalFn || setInterval;
  const setTimeoutFn = context.setTimeoutFn || setTimeout;

  const findStale = strategyWatchdog.findStaleStrategies || findStaleStrategiesDefault;
  const logStale = strategyWatchdog.logStaleSummary || logStaleSummaryDefault;

  // R3: in-memory last-fired state, owned by this scheduler. The scanner and
  // other runtimes must NOT import this module — they (or bootstrap glue)
  // report fires through `updateLastFired`, exposed on the returned object.
  // GAP: boot-seed from Supabase trade_logs (spec §3.2) requires supabase
  // context at bootstrap and is intentionally left as a follow-up wiring step.
  const strategyFireState = new Map();

  function updateLastFired(strategyId) {
    if (strategyId == null) return;
    strategyFireState.set(String(strategyId), Date.now());
  }

  function getStrategyFireState() {
    return strategyFireState;
  }

  async function runStrategyHealthCheck() {
    const now = Date.now();
    const strategies = getKnownStrategyIds().map(strategyId => ({
      strategyId,
      lastFiredAt: strategyFireState.get(String(strategyId)) ?? null
    }));
    const stale = findStale({
      strategies,
      now,
      staleAfterCycles: strategyStaleAfterCycles
    });
    if (stale.length === 0) {
      strategyHealthLog('[STRATEGY HEALTH] all alive');
    } else {
      strategyHealthLog(
        `[STRATEGY HEALTH] stale: ${stale.map(s => `${s.strategyId} (${s.status})`).join(', ')}`
      );
    }
    return { stale, summary: logStale(stale) };
  }

  async function paperTradingLoop() {
      await runLazyPaperTrading();
      setTimeoutFn(paperTradingLoop, 300000);
  }
  
  // 2. Chạy Khám nghiệm Hậu giao dịch PEE mỗi 5 phút
  async function postTradeEvaluationLoop() {
      await runExcursionEnrichment();
      await runPostTradeEvaluation();
      setTimeoutFn(postTradeEvaluationLoop, 300000);
  }
  
  // 3. Động cơ Trailing quét liên tục mỗi 5 giây
  async function trailingLoop() {
      await runSmartTrailingEngine();
      setTimeoutFn(trailingLoop, 5000);
  }
  // 4. Động cơ Đồng bộ Trạng thái chạy mỗi 3 giây
  async function ledgerSyncLoop() {
      await runLedgerStateSync();
      setTimeoutFn(ledgerSyncLoop, 3000);
  }
  // 5. Động cơ tự động dọn dẹp rác & Lệnh mồ côi (Chạy mỗi 20 giây)
  async function orphanCleanupLoop() {
      await runOrphanCleanupEngine();
      setTimeoutFn(orphanCleanupLoop, 20000);
  }
  let daemonServicesStarted = false;
  
  function startDaemonServices() {
      if (daemonServicesStarted) return;
      daemonServicesStarted = true;
  
      // Chỉ khởi động các kết nối và engine sau khi bind cổng thành công.
      // Điều này bảo đảm một instance bị EADDRINUSE không thể chạy trailing song song.
      startMarketStreams();
      syncMvrv();
      syncBinanceTime();
      setIntervalFn(syncBinanceTime, 120000);
      setIntervalFn(syncMvrv, 12 * 60 * 60 * 1000);
  
      setTimeoutFn(matrixScannerLoop, 5000);
      // R3 watchdog: first health check one scanner cycle after the first
      // scan, then every 5 minutes (staleAfterCycles=720 cycles ~= 12h at 60s).
      setTimeoutFn(runStrategyHealthCheck, 5000 + SCANNER_CYCLE_MS);
      setIntervalFn(runStrategyHealthCheck, 300000);
      setIntervalFn(async () => {
          console.log("🧠 [CRON] Kiểm tra dữ liệu mới và chạy optimizer...");
          await runOptimizationCycle();
      }, 3600000);
  
      paperTradingLoop();
      setTimeoutFn(postTradeEvaluationLoop, 300000);
      trailingLoop();
      orphanCleanupLoop();
      ledgerSyncLoop();
  
      // Giữ nguyên chu kỳ HUD hiện có.
      setIntervalFn(() => {
          getConnectedClients().forEach(ws => { if (ws.hudConfig) syncHUD(ws); });
      }, 10000);
  }

  return {
    startDaemonServices,
    // R3: fire-state reporting + check, for bootstrap glue and tests.
    // matrixScannerService intentionally stays untouched (no cross-module
    // import); bootstrap wires updateLastFired at the approved point.
    updateLastFired,
    getStrategyFireState,
    runStrategyHealthCheck
  };
}

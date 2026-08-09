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
    syncMvrv
  } = context;
  const setIntervalFn = context.setIntervalFn || setInterval;
  const setTimeoutFn = context.setTimeoutFn || setTimeout;

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

  return { startDaemonServices };
}

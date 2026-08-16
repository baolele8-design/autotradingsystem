// FILE: local-daemon/server.js 
import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';

import { runOptimizationEpoch } from './application/optimization/optimizer.js';
import { createOptimizationCycleService } from './application/optimization/optimizationCycleService.js';
import { createMatrixScannerService } from './application/scanner/matrixScannerService.js';
import { createDaemonScheduler } from './application/runtime/daemonScheduler.js';
import { createRuntimeState } from './application/runtime/runtimeState.js';
import { createHudService } from './application/monitoring/hudService.js';
import { createProtectionService } from './application/trading/protectionService.js';
import { createPostTradeEvaluationService } from './application/analytics/postTradeEvaluationService.js';
import { createExcursionEnrichmentService } from './application/analytics/excursionEnrichmentService.js';
import { createLiveTradePathService } from './application/analytics/liveTradePathService.js';
import { createLedgerSyncService } from './application/ledger/ledgerSyncService.js';
import { createPaperTradingService } from './application/simulation/paperTradingService.js';
import { createOrphanCleanupService } from './application/trading/orphanCleanupService.js';
import { createMvrvService } from './application/monitoring/mvrvService.js';
import { createBinanceGateway } from './infrastructure/binance/binanceGateway.js';
import {
    getSharedBinanceRateCoordinator
} from './infrastructure/binance/binanceRateCoordinator.js';
import { createMarketDataCache } from './infrastructure/realtime/marketDataCache.js';
import { createMarketStreams } from './infrastructure/realtime/marketStreams.js';
import { installUtf8Console } from './infrastructure/logging/utf8Console.js';
import { createDaemonSupabaseClient } from './infrastructure/supabase/supabaseClient.js';
import { registerRoutes } from './presentation/http/registerRoutes.js';
import {
    registerBinanceRateRoutes
} from './presentation/http/registerBinanceRateRoutes.js';
import { createWebSocketHub } from './presentation/websocket/webSocketHub.js';
import { daemonEnvironment } from './config/environment.js';
import './legacy/autoBot.js';

installUtf8Console();

const app = express();
app.use(cors({ exposedHeaders: ['x-mbx-used-weight-1m'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const {
    binance: {
        readApiKey: READ_API_KEY,
        readApiSecret: READ_API_SECRET,
        tradeApiKey: TRADE_API_KEY,
        tradeApiSecret: TRADE_API_SECRET
    },
    geminiApiKey: GEMINI_API_KEY,
    port: PORT,
    supabase: supabaseConfig
} = daemonEnvironment;
const supabase = createDaemonSupabaseClient(supabaseConfig);
const {
    getCurrentAiModel,
    getGlobalMvrvZScore,
    getMvrvState,
    getTimeOffset,
    loadLatestAiModel,
    setBinanceTimeReader,
    setGlobalMvrvZScore,
    syncBinanceTime
} = createRuntimeState({ supabase });
const staticExchangeCache = new Map();
const markPriceCache = new Map();
const rateCoordinator = getSharedBinanceRateCoordinator();


const btcReturnsCache = new Map();
const {
    getRateLimitState,
    readBinanceReq,
    readSpotBinanceReq,
    safeFetch,
    sendBinanceReq,
    sendSpotBinanceReq
} = createBinanceGateway({
    readApiKey: READ_API_KEY,
    readApiSecret: READ_API_SECRET,
    tradeApiKey: TRADE_API_KEY,
    tradeApiSecret: TRADE_API_SECRET,
    getTimeOffset,
    rateCoordinator
});
setBinanceTimeReader(() => safeFetch(
    'https://fapi.binance.com/fapi/v1/time',
    { maxRetries: 0, priority: 'reconciliation', ttlMs: 0 }
));
// Rolling force-order events; consumers only receive normalized 15m snapshots.
const liquidationsCache = new Map();

const marketDataCache = createMarketDataCache({
    markPriceCache,
    safeFetch
});

const liveTradePathService = createLiveTradePathService({
    marketDataCache,
    supabase
});

const {
    getLiquidationSnapshot,
    startMarketStreams
} = createMarketStreams({
    liquidationsCache,
    marketDataCache
});

const { syncMvrv } = createMvrvService({
    safeFetch,
    setGlobalMvrvZScore
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
wss.on('error', error => {
    // WebSocketServer chuyển tiếp lỗi từ HTTP server. Nếu không có listener này,
    // EADDRINUSE sẽ trở thành một "Unhandled error event" trước khi HTTP handler
    // kịp kết thúc instance thứ hai.
    if (error.code !== 'EADDRINUSE') {
        console.error('[WEBSOCKET SERVER ERROR]', error);
    }
});

server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(
            `[DAEMON SINGLETON] Port ${PORT} đã được sử dụng. ` +
            'Dừng instance thứ hai để tránh hai trailing engine cùng sửa lệnh.'
        );
        process.exit(1);
    }
    throw error;
});

server.listen(PORT, async () => {
    console.log(`🚀 Daemon Server running on port ${PORT}`);
    try {
        await syncBinanceTime();
        await loadLatestAiModel();
        startDaemonServices();
        await runOptimizationCycle();
    } catch (e) { console.log("❌ Lỗi chạy Optimizer lúc boot:", e); }
});

const {
    matrixScannerLoop,
    getBtcRegimeSnapshot
} = createMatrixScannerService({
    btcReturnsCache,
    getConnectedClients: () => getConnectedClients(),
    getCurrentAiModel,
    getGlobalMvrvZScore,
    getLiquidationSnapshot,
    marketDataCache,
    readBinanceReq,
    safeFetch,
    sendBinanceReq,
    supabase
});

const { syncHUD } = createHudService({
    btcReturnsCache,
    getLiquidationSnapshot,
    getMvrvState,
    getRateLimitState,
    marketDataCache,
    readBinanceReq,
    safeFetch,
    staticExchangeCache
});

const { broadcast, getConnectedClients } = createWebSocketHub({
    marketDataCache,
    syncHUD,
    wss
});

const {
    cancelExactOrder,
    runSmartTrailingEngine,
    withSymbolOrderLock
} = createProtectionService({
    getCurrentAiModel,
    markPriceCache,
    marketDataCache,
    observeOpenTrades: liveTradePathService.observeOpenTrades,
    readBinanceReq,
    safeFetch,
    sendBinanceReq,
    supabase
});

const { runPostTradeEvaluation } =
    createPostTradeEvaluationService({
        safeFetch,
        supabase
    });
const { runExcursionEnrichment } =
    createExcursionEnrichmentService({
        safeFetch,
        supabase
    });
const { runOptimizationCycle } =
    createOptimizationCycleService({
        getCurrentAiModel,
        loadLatestAiModel,
        prepareTrainingData: async () => {
            const excursionResult = await runExcursionEnrichment();
            const peeResult = await runPostTradeEvaluation();
            return (
                excursionResult?.status !== 'FAILED' &&
                peeResult?.status !== 'FAILED'
            );
        },
        runOptimizationEpoch
    });

const { runLazyPaperTrading } = createPaperTradingService({
    safeFetch,
    supabase
});

const { runLedgerStateSync } = createLedgerSyncService({
    markPriceCache,
    marketDataCache,
    readBinanceReq,
    sendBinanceReq,
    supabase
});

const { runOrphanCleanupEngine } = createOrphanCleanupService({
    readBinanceReq,
    sendBinanceReq,
    supabase,
    withSymbolOrderLock
});

registerRoutes({
    app,
    broadcastLedgerChanged: broadcast,
    cancelExactOrder,
    geminiApiKey: GEMINI_API_KEY,
    getMvrvState,
    getRateLimitState,
    readBinanceReq,
    readSpotBinanceReq,
    safeFetch,
    sendBinanceReq,
    sendSpotBinanceReq,
setGlobalMvrvZScore,
    supabase,
    withSymbolOrderLock,
    getBtcRegimeSnapshot
});
registerBinanceRateRoutes({ app, rateCoordinator });

const { startDaemonServices } =
    createDaemonScheduler({
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
    });

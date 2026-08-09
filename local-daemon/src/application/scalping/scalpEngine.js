import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import {
  evaluateScalpSignalsWithDiagnostics
} from '../../domain/scalping/scalpSignals.js';
import {
  getStrategyParams,
  loadScalpParams,
  runScalpOptimization
} from '../../domain/scalping/scalpOptimizer.js';
import {
  findPositionForTrade,
  isOwnedAlgoOrder,
  makeClientAlgoId,
  makeInitialClientAlgoId,
  makePositionReductionPayload,
  makeTradeOwnershipToken,
  replaceStopSafely
} from '../../domain/orders/trailingOrders.js';
import { createBinanceGateway } from '../../infrastructure/binance/binanceGateway.js';
import QuantMath from '../../../../src/domain/analytics/QuantMath.js';
import {
  evaluateNewEntrySymbol,
  isNewEntrySymbolAllowed
} from '../../../../src/domain/trading/symbolEntryPolicy.js';
import {
  calculateScalpTrailingDecision,
  calculateScalpTemporalBarrier
} from '../../domain/scalping/scalpTrailing.js';
import {
  buildScalpMarketContext,
  mergeCandle,
  normalizeRestKline,
  normalizeStreamKline
} from '../../domain/scalping/scalpMarketContext.js';

const DEFAULT_CONFIG = {
  coins: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'LINKUSDT', 'DOGEUSDT', 'SUIUSDT', 'AVAXUSDT'],
  intervals: {
    '5m':  { maxHoldCandles: 12, leverage: 5, riskPct: 1.2, slATR: 1.8, tpATR: 2.5, cooldownMs: 180_000 },
    '15m': { maxHoldCandles: 8,  leverage: 3, riskPct: 1.5, slATR: 2.2, tpATR: 3.1, cooldownMs: 240_000 },
    '1h':  { maxHoldCandles: 6,  leverage: 3, riskPct: 1.8, slATR: 2.8, tpATR: 4.2, cooldownMs: 300_000 }
  },
  maxCapital: 280,
  marginPerTrade: 35,
  maxPositions: 8,
  scanIntervalMs: 5_000,
  rpcTimeoutMs: 8_000,
  wsReconnectMs: 5_000,
  candleHistory: 260,
  dataFreshnessMs: 5_000,
  websocketStaleMs: 20_000,
  safety: {
    minStopPct: 0.002,
    maxStopPct: 0.04,
    maxTakeProfitPct: 0.06,
    maxRiskPct: 3
  }
};

const INTERVAL_MS = Object.freeze({
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000
});

const MARKET_INTERVALS = Object.freeze(['5m', '15m', '1h', '4h']);

function buildRuntimeConfig(overrides = {}) {
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides || {}).filter(
      ([, value]) => value !== undefined
    )
  );
  const intervals = Object.fromEntries(
    Object.entries(DEFAULT_CONFIG.intervals).map(
      ([interval, defaults]) => [
        interval,
        {
          ...defaults,
          ...(definedOverrides.intervals?.[interval] || {})
        }
      ]
    )
  );
  return {
    ...DEFAULT_CONFIG,
    ...definedOverrides,
    coins:
      Array.isArray(definedOverrides.coins) &&
      definedOverrides.coins.length > 0
        ? [...new Set(
          definedOverrides.coins.map(symbol =>
            String(symbol).trim().toUpperCase()
          )
        )]
        : DEFAULT_CONFIG.coins,
    intervals,
    safety: {
      ...DEFAULT_CONFIG.safety,
      ...(definedOverrides.safety || {})
    }
  };
}

const numeric = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

const formatPrecision = (val, step) => {
  const numVal = parseFloat(val);
  const numStep = parseFloat(step);
  if (isNaN(numVal) || isNaN(numStep) || numStep === 0) return '0';
  let stepStr = numStep.toString();
  if (stepStr.includes('e-')) stepStr = numStep.toFixed(parseInt(stepStr.split('e-')[1], 10));
  const precision = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
  return (Math.round(numVal / numStep) * numStep).toFixed(precision);
};

const toISO = (ts) => {
  try { return new Date(ts).toISOString(); } catch (_) { return new Date().toISOString(); }
};

const toUtcHour = () => new Date().getUTCHours();

const sessionFromHour = (h) => {
  if (h >= 0 && h < 8) return 'ASIAN';
  if (h >= 8 && h < 15) return 'LONDON';
  if (h >= 15 && h < 20) return 'NY_AM';
  return 'NY_PM';
};

export function resolveScalpExitReason(trade, exitFill, algoStates = {}) {
  const storedReason = String(trade?.exitReason || trade?.exit_reason || '');
  if (
    storedReason &&
    !['PNL_RECONCILIATION_PENDING', 'CLOSED_BY_TP_SL'].includes(storedReason)
  ) {
    return storedReason;
  }
  const exitOrderId = exitFill?.orderId;
  const matches = state => (
    ['TRIGGERED', 'FINISHED'].includes(
      String(state?.algoStatus || '').toUpperCase()
    ) &&
    state?.actualOrderId !== undefined &&
    state?.actualOrderId !== null &&
    String(state.actualOrderId) === String(exitOrderId)
  );
  if (matches(algoStates.tp)) return 'TAKE_PROFIT_HIT';
  if (matches(algoStates.sl)) {
    return trade?.trailing_activated ||
      String(trade?.protectionStage || 'NONE').toUpperCase() !== 'NONE'
      ? 'TRAILING_STOP_HIT'
      : 'STOP_LOSS_HIT';
  }
  return 'UNCLASSIFIED_EXCHANGE_CLOSE';
}

export function startScalpEngine({
  supabase,
  environment,
  binanceGateway: injectedGateway,
  rateCoordinator,
  autoStart = true
} = {}) {
  const CONFIG = buildRuntimeConfig(environment?.scalp);
  const TRADE_API_KEY = environment?.scalpBinance?.tradeApiKey || environment?.binance?.tradeApiKey || '';
  const TRADE_API_SECRET = environment?.scalpBinance?.tradeApiSecret || environment?.binance?.tradeApiSecret || '';
  const READ_API_KEY = environment?.scalpBinance?.readApiKey || environment?.binance?.readApiKey || TRADE_API_KEY;
  const READ_API_SECRET = environment?.scalpBinance?.readApiSecret || environment?.binance?.readApiSecret || TRADE_API_SECRET;

  if ((!TRADE_API_KEY || !TRADE_API_SECRET) && !injectedGateway) {
    console.error('[SCALP] ❌ CẢNH BÁO: Chưa tìm thấy BINANCE_TRADE_API_KEY / SCALP_BINANCE_TRADE_API_KEY hoặc Secret trong môi trường (.env)! Vui lòng kiểm tra lại cấu hình.');
  }

  const formatApiError = (e) => {
    if (e?.response?.data) {
      const msg = e.response.data.msg || e.response.data.message;
      const code = e.response.data.code;
      if (msg) return `${msg}${code !== undefined ? ` (code: ${code})` : ''}`;
    }
    return e.message;
  };

  let timeOffset = 0;
  let exchangeInfoCache = null;
  let isProcessing = false;
  let isMonitoring = false;

  const intervalCaches = new Map(
    MARKET_INTERVALS.map(interval => [interval, new Map()])
  );
  const candleCache = intervalCaches.get('5m');
  const htfCandleCache = intervalCaches.get('1h');
  const depthCache = new Map();
  const openTrades = new Map();
  const actionCooldowns = new Map();
  const lastEvaluatedCandle = new Map();
  const gateRejectCounts = new Map();
  let learnedParams = {};
  let websocket = null;
  let websocketReconnectTimer = null;
  let lastWebsocketMessageAt = 0;
  let lastSuccessfulScanAt = 0;

  const openTradeSupabaseIds = new Set();

  for (const coin of CONFIG.coins) {
    for (const cache of intervalCaches.values()) cache.set(coin, []);
  }

  const binanceGateway = injectedGateway || createBinanceGateway({
    readApiKey: READ_API_KEY,
    readApiSecret: READ_API_SECRET,
    tradeApiKey: TRADE_API_KEY,
    tradeApiSecret: TRADE_API_SECRET,
    getTimeOffset: () => timeOffset,
    rateCoordinator
  });

  const sendBinanceReq = binanceGateway.sendBinanceReq;
  const safeFetch = binanceGateway.safeFetch;

  const withTimeout = (promise, label) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(
            new Error(`${label} timeout after ${CONFIG.rpcTimeoutMs}ms`)
          ),
          CONFIG.rpcTimeoutMs
        );
      })
    ]).finally(() => clearTimeout(timer));
  };

  const readPublic = async (endpoint, params) => {
    if (safeFetch) {
      const query = new URLSearchParams(params).toString();
      const data = await withTimeout(
        safeFetch(`https://fapi.binance.com${endpoint}?${query}`, {
          ttlMs: 0,
          priority: 'market-data'
        }),
        `${endpoint} public read`
      );
      return { data };
    }
    return withTimeout(
      sendBinanceReq('GET', endpoint, params),
      `${endpoint} read`
    );
  };

  const syncBinanceTime = async () => {
    try {
      const res = await sendBinanceReq('GET', '/fapi/v1/time');
      if (res?.data?.serverTime) {
        timeOffset = res.data.serverTime - Date.now();
      }
    } catch (e) {
      console.error('[SCALP] Lỗi đồng bộ giờ:', e.message);
    }
  };

  const fetchExchangeInfo = async () => {
    try {
      const res = await sendBinanceReq('GET', '/fapi/v1/exchangeInfo');
      if (res?.data) {
        exchangeInfoCache = res.data;
        console.log('[SCALP] Đã tải Exchange Info.');
      }
    } catch (e) {
      console.error('[SCALP] Lỗi Exchange Info:', e.message);
    }
  };

  const loadMarketCandles = async (symbol, interval, silent = false) => {
    try {
      const existingCandles = intervalCaches.get(interval)?.get(symbol) || [];
      const isSmartUpdate = existingCandles.length >= 200;
      const fetchLimit = isSmartUpdate ? 5 : CONFIG.candleHistory;

      const response = await readPublic('/fapi/v1/klines', {
        symbol,
        interval,
        limit: fetchLimit
      });
      const newCandles = (response?.data || [])
        .map(kline => normalizeRestKline(kline))
        .filter(candle => candle.isClosed);

      if (isSmartUpdate) {
        newCandles.forEach(candle => mergeCandle(existingCandles, candle, CONFIG.candleHistory + 40));
      } else {
        intervalCaches.get(interval).set(symbol, newCandles);
      }

      if (!silent) {
        const finalCount = intervalCaches.get(interval).get(symbol)?.length || 0;
        console.log(
          `[SCALP] Đã tải ${isSmartUpdate ? 'smart(5)' : fetchLimit} nến ${interval} cho ${symbol}. Total: ${finalCount}`
        );
      }
    } catch (error) {
      console.error(
        `[SCALP] Lỗi tải nến ${symbol} ${interval}:`,
        error.message
      );
    }
  };

  const updateMarketCandle = (symbol, message, interval) => {
    const candles = intervalCaches.get(interval)?.get(symbol);
    const candle = normalizeStreamKline(message);
    if (!candles || !candle) return;
    mergeCandle(candles, candle, CONFIG.candleHistory + 40);
  };

  const refreshScalpCoinPool = async () => {
    try {
      console.log('[SCALP] Đang quét bể coin động (Tier 1,2 - Min Notional < 50)...');
      if (!exchangeInfoCache) {
        await fetchExchangeInfo();
      }
      const tickerResp = await readPublic('/fapi/v1/ticker/24hr');
      if (!tickerResp?.data || !Array.isArray(tickerResp.data)) return;
      
      let candidates = [];
      for (const t of tickerResp.data) {
        if (!t.symbol.endsWith('USDT')) continue;
        if (!isNewEntrySymbolAllowed(t.symbol)) continue;
        
        const info = exchangeInfoCache.symbols.find(s => s.symbol === t.symbol);
        if (!info || numeric(info.filters.find(f => f.filterType === 'MIN_NOTIONAL')?.minNotional || 0) >= 50) continue;
        
        const usdVol = numeric(t.quoteVolume);
        if (usdVol < 15000000) continue;
        
        const bid = numeric(t.bidPrice);
        const ask = numeric(t.askPrice);
        let spreadPct = 0.05;
        if (bid > 0 && ask > 0) spreadPct = ((ask - bid) / ask) * 100;
        
        const tier = QuantMath.classifyAssetTier(t.symbol, usdVol, spreadPct);
        if (tier.startsWith('Tier 1') || tier.startsWith('Tier 2')) {
          candidates.push({ symbol: t.symbol, vol: usdVol });
        }
      }
      
      candidates.sort((a, b) => b.vol - a.vol);
      const newCoins = candidates.slice(0, 10).map(c => c.symbol);
      
      if (newCoins.length > 0) {
        const oldCoinsStr = CONFIG.coins.join(',');
        const newCoinsStr = newCoins.join(',');
        if (oldCoinsStr !== newCoinsStr) {
          console.log(`[SCALP] Bể coin đã thay đổi! Mới: ${newCoinsStr} (Tốc độ: ${newCoins.length} coins)`);
          CONFIG.coins = newCoins;
          if (websocket) {
            console.log(`[SCALP] Đang ngắt kết nối WebSocket để cấu hình lại...`);
            websocket.close();
          }
        } else {
          console.log('[SCALP] Bể coin không thay đổi.');
        }
      }
    } catch (e) {
      console.error('[SCALP] Lỗi refreshScalpCoinPool:', e.message);
    }
  };

  const connectMarketWebSocket = () => {
    if (
      websocket &&
      (
        websocket.readyState === WebSocket.OPEN ||
        websocket.readyState === WebSocket.CONNECTING
      )
    ) return;

    const streams = [];
    for (const coin of CONFIG.coins) {
      for (const interval of MARKET_INTERVALS) {
        streams.push(`${coin.toLowerCase()}@kline_${interval}`);
      }
      streams.push(`${coin.toLowerCase()}@depth20@500ms`);
    }
    websocket = new WebSocket(
      `wss://fstream.binance.com/stream?streams=${streams.join('/')}`
    );

    websocket.on('open', () => {
      lastWebsocketMessageAt = Date.now();
      console.log('[SCALP] WebSocket kline + depth đã kết nối.');
    });
    websocket.on('message', raw => {
      try {
        const message = JSON.parse(raw);
        const event = message?.data;
        lastWebsocketMessageAt = Date.now();
        if (event?.e === 'kline' &&
            MARKET_INTERVALS.includes(event.k?.i)) {
          updateMarketCandle(event.s, event, event.k.i);
        } else if (event?.e === 'depthUpdate') {
          depthCache.set(event.s, {
            bids: event.b,
            asks: event.a,
            receivedAt: Date.now(),
            eventTime: numeric(event.E)
          });
        }
      } catch (error) {
        console.error('[SCALP] WebSocket payload lỗi:', error.message);
      }
    });
    websocket.on('close', () => {
      websocket = null;
      clearTimeout(websocketReconnectTimer);
      websocketReconnectTimer = setTimeout(
        connectMarketWebSocket,
        CONFIG.wsReconnectMs
      );
    });
    websocket.on('error', error => {
      console.error('[SCALP] WebSocket lỗi:', error.message);
    });
  };

  const ensureWebsocketFresh = () => {
    if (
      lastWebsocketMessageAt > 0 &&
      Date.now() - lastWebsocketMessageAt <= CONFIG.websocketStaleMs
    ) return true;
    if (websocket) {
      websocket.terminate();
      websocket = null;
    }
    connectMarketWebSocket();
    return false;
  };

  let lastActiveCount = -1;

  const getActivePositions = async (priority = 'account') => {
    try {
      const res = await sendBinanceReq(
        'GET',
        '/fapi/v2/positionRisk',
        {},
        { priority }
      );
      const all = res?.data || [];
      const active = all.filter(p => numeric(p.positionAmt) !== 0);
      if (active.length !== lastActiveCount) {
        lastActiveCount = active.length;
        if (active.length > 0) {
          const summary = active.map(p => `${p.symbol} ${p.positionAmt}`).join(', ');
          console.log(`[SCALP] Vị thế (${active.length}): ${summary}`);
        } else {
          console.log('[SCALP] Không có vị thế.');
        }
      }
      return active;
    } catch (e) {
      console.error('[SCALP] Lỗi đọc vị thế:', formatApiError(e));
      return null;
    }
  };

  const getOpenOrders = async (priority = 'account') => {
    try {
      const res = await sendBinanceReq(
        'GET',
        '/fapi/v1/openOrders',
        {},
        { priority }
      );
      return res?.data || [];
    } catch (e) {
      console.error('[SCALP] Lỗi đọc lệnh mở:', formatApiError(e));
      return null;
    }
  };

  // Dùng cho: pre-flight cleanup trước lệnh mới & đóng tay thủ công (marketClosePosition)
  // KHÔNG dùng khi lệnh đóng tự nhiên qua TP/SL — dùng cancelAlgoOrdersForTrade thay thế
  // Dùng khi lệnh đóng tự nhiên (TP/SL hit) — chỉ xóa đúng CO của lệnh đó, bảo toàn CO của lệnh mới
  const cancelAlgoOrdersForTrade = async (trade) => {
    const symbol = trade.symbol;
    const algoIds = new Set(
      [trade.slAlgoId, trade.tpAlgoId]
        .filter(id => id != null && id !== '')
        .map(String)
    );
    const openAlgoResponse = await sendBinanceReq(
      'GET',
      '/fapi/v1/openAlgoOrders',
      { symbol },
      { priority: 'protection' }
    ).catch(() => null);
    const openAlgoOrders = Array.isArray(openAlgoResponse?.data)
      ? openAlgoResponse.data
      : openAlgoResponse?.data?.orders || [];
    for (const order of openAlgoOrders) {
      const clientId = String(
        order.clientAlgoId ?? order.clientOrderId ?? ''
      );
      const belongsToTrade =
        order.symbol === symbol &&
        isOwnedAlgoOrder(order) &&
        (
          clientId === trade.slClientAlgoId ||
          clientId === trade.tpClientAlgoId ||
          (
            trade.ownershipToken &&
            clientId.includes(trade.ownershipToken)
          )
        );
      if (belongsToTrade && order.algoId != null) {
        algoIds.add(String(order.algoId));
      }
    }

    if (algoIds.size > 0) {
      for (const algoId of algoIds) {
        try {
          await sendBinanceReq('DELETE', '/fapi/v1/algoOrder', { symbol, algoId });
          console.log(`[SCALP 🧹] ${symbol} algoId=${algoId} đã hủy`);
        } catch (e) { /* already triggered/filled — OK */ }
      }
    } else {
      // Fallback: lệnh cũ không có algoId → bỏ qua để bảo vệ lệnh mới
      console.log(`[SCALP ⚠️] ${symbol} không có algoId (lệnh cũ). Bỏ qua xóa CO.`);
    }
  };

  const readAlgoStatesForTrade = async trade => {
    const states = {};
    for (const [kind, algoId] of [
      ['sl', trade.slAlgoId],
      ['tp', trade.tpAlgoId]
    ]) {
      if (algoId === undefined || algoId === null || algoId === '') continue;
      const response = await sendBinanceReq(
        'GET',
        '/fapi/v1/algoOrder',
        { symbol: trade.symbol, algoId },
        { priority: 'protection' }
      ).catch(() => null);
      if (response?.data) states[kind] = response.data;
    }
    return states;
  };

  const marketClosePosition = async (
    symbol,
    side,
    quantity,
    position = null
  ) => {
    try {
      await sendBinanceReq(
        'POST',
        '/fapi/v1/order',
        makePositionReductionPayload(position, {
        symbol,
        side: side === 'LONG' ? 'SELL' : 'BUY',
        type: 'MARKET',
        quantity,
        reduceOnly: 'true'
        })
      );
    } catch (e) {
      console.error(`[SCALP] Lỗi đóng vị thế ${symbol}:`, formatApiError(e));
    }
  };

  const insertTradeLog = async (trade) => {
    try {
      const { data, error } = await supabase
        .from('scalp_trade_logs')
        .insert([trade])
        .select('id')
        .single();
      if (error) {
        console.error('[SCALP] Lỗi ghi Supabase:', error.message);
        return null;
      }
      return data?.id || null;
    } catch (e) {
      console.error('[SCALP] Lỗi Supabase:', e.message);
      return null;
    }
  };

  const updateTradeStatus = async (supabaseId, updates) => {
    try {
      const { error } = await supabase
        .from('scalp_trade_logs')
        .update(updates)
        .eq('id', supabaseId);
      if (error) throw error;
      return true;
    } catch (e) {
      console.error('[SCALP] Lỗi cập nhật trade:', e.message);
    }
  };

  const deleteUnfilledTradeLog = async supabaseId => {
    try {
      const { error } = await supabase
        .from('scalp_trade_logs')
        .delete()
        .eq('id', supabaseId);
      if (error) throw error;
    } catch (error) {
      console.error(
        '[SCALP] Lỗi xóa ledger chưa khớp:',
        error.message
      );
    }
  };

  const verifyScalpLedgerSchema = async () => {
    const requiredColumns = [
      'ownership_token',
      'entry_order_id',
      'entry_client_order_id',
      'sl_algo_id',
      'tp_algo_id',
      'sl_client_algo_id',
      'tp_client_algo_id',
      'filled_at',
      'actual_entry',
      'realized_pnl_gross_usd',
      'commission_usd',
      'funding_fee_usd',
      'pnl_attribution',
      'atr_rank',
      'gate_diagnostics'
    ];
    const { error } = await supabase
      .from('scalp_trade_logs')
      .select(requiredColumns.join(','))
      .limit(1);
    if (error) {
      throw new Error(
        'SCALP_SCHEMA_NOT_READY: chạy local-daemon/sql/' +
        `scalp_execution_ownership.sql trong Supabase (${error.message})`
      );
    }
    return true;
  };

  const executeScalpTrade = async (signal, symbol, liveCapital, interval = '5m') => {
    const symbolPolicy = evaluateNewEntrySymbol(symbol);
    if (!symbolPolicy.allowed) {
      console.log(
        `[SCALP ENTRY BLOCKED] ${symbolPolicy.symbol || '(empty)'} ` +
        `rule=${symbolPolicy.code}`
      );
      return;
    }
    if (!exchangeInfoCache) return;

    try {
      const symInfo = exchangeInfoCache.symbols.find(s => s.symbol === symbol);
      if (!symInfo) {
        console.log(`[SCALP] Không tìm thấy ${symbol} trong Exchange Info`);
        return;
      }

      const stepSize = numeric(symInfo.filters.find(f => f.filterType === 'LOT_SIZE')?.stepSize);
      const tickSize = numeric(symInfo.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize);
      const notionalFilter = symInfo.filters.find(f => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL');
      const minNotional = numeric(notionalFilter?.notional || notionalFilter?.minNotional) || 5;

      if (stepSize <= 0 || tickSize <= 0) {
        console.log(`[SCALP] Lỗi filters cho ${symbol}`);
        return;
      }

      const intervalConfig = CONFIG.intervals[interval];
      const strategyParams = getStrategyParams(
        signal.strategyId,
        symbol,
        learnedParams
      );
      const entry = signal.entry;
      const isLong = signal.direction === 'LONG';

      // Offset entry để LIMIT dễ khớp: LONG đặt thấp hơn 0.05%, SHORT đặt cao hơn
      const entryBuffer = strategyParams.entry_buffer;
      const entryPrice = isLong
        ? entry * (1 - entryBuffer)
        : entry * (1 + entryBuffer);

      // ATR-based dynamic SL/TP
      const atr = numeric(signal.indicators?.atr);
      if (atr <= 0) {
        throw new Error(`${symbol} thiếu ATR thật; không đặt lệnh`);
      }
      const slDist = atr * intervalConfig.slATR;
      const tpDist = atr * intervalConfig.tpATR;
      // Only same-engine scalp outcomes may shape SL/TP distance. Main-bot
      // rows run on different holding horizons and remain gate evidence only.
      const priorEvidence = numeric(strategyParams.sample_count);
      const priorWeight = priorEvidence / (priorEvidence + 30);
      const atrSlPct = slDist / entryPrice;
      const atrTpPct = tpDist / entryPrice;
      const slPct = clamp(
        atrSlPct * (1 - priorWeight) +
          strategyParams.sl_percent * priorWeight,
        CONFIG.safety.minStopPct,
        CONFIG.safety.maxStopPct
      );
      const tpPct = clamp(
        atrTpPct * (1 - priorWeight) +
          strategyParams.tp_percent * priorWeight,
        slPct * 1.2,
        CONFIG.safety.maxTakeProfitPct
      );

      const slPrice = isLong ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct);
      const tpPrice = isLong ? entryPrice * (1 + tpPct) : entryPrice * (1 - tpPct);

      // Dynamic position sizing: risk = riskPct% of capital (capped at CONFIG.maxCapital)
      const riskBudget = liveCapital * (intervalConfig.riskPct / 100);
      const targetNotional = riskBudget / slPct;
      const maxNotional = CONFIG.marginPerTrade * intervalConfig.leverage;

      // Ensure position size is ALWAYS greater than minNotional + $2.5 buffer to prevent Binance MIN_NOTIONAL errors
      const minRequiredNotional = Math.max(minNotional + 2.5, minNotional * 1.25);
      const finalNotional = Math.max(minRequiredNotional, Math.min(targetNotional, maxNotional));

      let rawQty = finalNotional / entryPrice;
      let finalQty = formatPrecision(rawQty, stepSize);

      if (numeric(finalQty) * entry < minRequiredNotional) {
        rawQty += numeric(stepSize);
        finalQty = formatPrecision(rawQty, stepSize);
      }

      if (numeric(finalQty) <= 0) {
        console.log(`[SCALP] ${symbol} qty=0, bỏ qua`);
        return;
      }

      const finalEntry = formatPrecision(entryPrice, tickSize);
      const finalSl = formatPrecision(slPrice, tickSize);
      const finalTp = formatPrecision(tpPrice, tickSize);

      if (numeric(finalQty) * numeric(finalEntry) < minRequiredNotional) {
        console.log(`[SCALP] ${symbol} [${interval}] notional sau làm tròn ${(numeric(finalQty) * numeric(finalEntry)).toFixed(2)} < minRequiredNotional $${minRequiredNotional.toFixed(2)}, bỏ qua`);
        return;
      }

      const actualRisk = numeric(finalQty) * Math.abs(numeric(finalEntry) - numeric(finalSl));
      const actualRiskPct = liveCapital > 0 ? (actualRisk / liveCapital) * 100 : 0;

      // Safety check: actual risk must be <= 3% of capital
      if (actualRiskPct > CONFIG.safety.maxRiskPct) {
        console.log(`[SCALP] ${symbol} [${interval}] risk ${actualRiskPct.toFixed(2)}% vượt ngưỡng 3%, bỏ qua`);
        return;
      }

      console.log(`[SCALP] ${symbol} [${interval}] ${signal.direction} | ${signal.strategyId} | Score=${signal.score} | Entry=${finalEntry} | SL=${finalSl} (${(slPct*100).toFixed(2)}%) | TP=${finalTp} (${(tpPct*100).toFixed(2)}%) | Risk=$${actualRisk.toFixed(2)} (${actualRiskPct.toFixed(2)}%) | ATR=${atr.toFixed(6)} | Qty=${finalQty}`);

      // Pre-flight cleanup: Dọn sạch mọi lệnh cũ & lệnh CO mồ côi trước khi vào lệnh mới
      const side = signal.direction === 'LONG' ? 'BUY' : 'SELL';
      const exitSide = signal.direction === 'LONG' ? 'SELL' : 'BUY';
      const ownershipToken = makeTradeOwnershipToken(randomUUID());
      const entryClientOrderId =
        `qts-entry-${ownershipToken}`.slice(0, 36);
      const slClientAlgoId = makeInitialClientAlgoId(
        'sl',
        ownershipToken
      );
      const tpClientAlgoId = makeInitialClientAlgoId(
        'tp',
        ownershipToken
      );

      await sendBinanceReq('POST', '/fapi/v1/marginType', {
        symbol, marginType: 'ISOLATED'
      }).catch(e => e);

      await sendBinanceReq('POST', '/fapi/v1/leverage', {
        symbol, leverage: intervalConfig.leverage
      }).catch(e => e);

      const entryPayload = {
        symbol,
        side,
        type: 'LIMIT',
        timeInForce: 'GTC',
        quantity: finalQty,
        price: finalEntry,
        newClientOrderId: entryClientOrderId
      };

      const entryResponse = await sendBinanceReq(
        'POST',
        '/fapi/v1/order',
        entryPayload
      );
      const entryOrderId =
        entryResponse?.data?.orderId ??
        entryResponse?.orderId ??
        null;

      let slAlgoId = null;
      let tpAlgoId = null;

      const holdingCycles = intervalConfig.maxHoldCandles;
      const session = sessionFromHour(toUtcHour());
      const openedAt = toISO(Date.now());
      const actualNotional = numeric(finalQty) * numeric(finalEntry);

      const tradeRecord = {
        symbol,
        interval,
        type: 'FUTURES',
        direction: signal.direction,
        entry: numeric(finalEntry),
        sl: numeric(finalSl),
        initial_sl: numeric(finalSl),
        initial_risk_per_coin: Math.abs(numeric(finalEntry) - numeric(finalSl)),
        tp_1_price: numeric(finalTp),
        risk_amount_usd: Math.max(0.01, numeric(actualRisk)),
        position_size_usd: numeric(actualNotional),
        rr: tpPct / (slPct || 0.001),

        adx: numeric(signal.indicators?.adx || 0),
        atr: numeric(atr),
        rsi: numeric(signal.indicators?.rsi || 50),
        cmf: null,

        leverage: intervalConfig.leverage,
        status: 'PENDING',
        pnl_usd: 0,
        session,
        strategy_name: `${signal.strategyId} [SCALP]`,
        capital_at_entry_usd: numeric(liveCapital),
        strategy_version: 'scalp-v2.0.0',
        applied_risk_pct: numeric(actualRiskPct.toFixed(2)),
        asset_tier: 'Tier 2',
        holding_cycles: holdingCycles,
        soft_score: numeric(signal.score),
        opened_at: openedAt,
        ownership_token: ownershipToken,
        entry_order_id: entryOrderId,
        entry_client_order_id: entryClientOrderId,
        sl_algo_id: slAlgoId,
        tp_algo_id: tpAlgoId,
        sl_client_algo_id: slClientAlgoId,
        tp_client_algo_id: tpClientAlgoId,
        gate_diagnostics: signal.gateDiagnostics || null,

        bbw_rank: signal.details?.bbwRank ?? null,
        atr_rank: signal.details?.atrRank ?? null,
        oi_delta: null,
        funding_rate: null,
        funding_slope: null,
        taker_ratio: signal.details?.takerRatio ?? null,
        btc_dom_slope: null,
        mvrv: null,
        fgi: null,
        vpin: null,
        obi: signal.details?.obi ?? null,
        amihud: null,
        isi: null,
        cvd_trend: signal.details?.cvdTrend ?? null,
        vwap: signal.details?.vwap ?? null,
        vwap_upper: signal.details?.vwapUpper ?? null,
        vwap_lower: signal.details?.vwapLower ?? null,
        hurst_value: signal.details?.hurstValue ?? null,
        liq_longs_vol: null,
        liq_shorts_vol: null,
        true_ev: null,
        kelly_pct: null,
        trailing_activated: false,

        protection_stage: 'NONE',
        high_water_price: numeric(finalEntry),
        high_water_r: 0,

        gate_s1: signal.gateDiagnostics?.find(
          item => item.strategyId === 'S1_EMA_MOMENTUM'
        )?.passed ?? signal.strategyId === 'S1_EMA_MOMENTUM',
        gate_s2: signal.gateDiagnostics?.find(
          item => item.strategyId === 'S2_RSI_SNAP'
        )?.passed ?? signal.strategyId === 'S2_RSI_SNAP',
        gate_s3: signal.gateDiagnostics?.find(
          item => item.strategyId === 'S3_BB_SQUEEZE'
        )?.passed ?? signal.strategyId === 'S3_BB_SQUEEZE',
        gate_s4: false,
        gate_s5: false,
        gate_s6: false,
        gate_s7: false,
        gate_s8: false,

        trend_sma200:
          signal.details?.l1?.includes('Up') ? 'UP' :
            signal.details?.l1?.includes('Down') ? 'DOWN' :
              null,
        l1_structure: signal.details?.l1 ?? null,
        l2_volatility: signal.details?.l2 ?? null,
        l3_liq_event: signal.details?.l3 ?? null,
        l4_positioning: null,
        l5_momentum: null,
        l6_macro: null,
        epoch_id: `scalp-${ownershipToken}`,
        slippage_usd: null,
        max_favorable_excursion_usd: null,
        max_adverse_excursion_usd: null,
        pee_analyzed: false,
        exit_reason: null
      };

      const dbId = await insertTradeLog(tradeRecord);

      if (dbId) {
        openTrades.set(symbol, {
          ...signal,
          supabaseId: dbId,
          openedAt,
          symbol,
          interval,
          qty: finalQty,
          slPrice: finalSl,
          initialSl: finalSl,
          tpPrice: finalTp,
          entryPrice: finalEntry,
          side,
          exitSide,
          maxHoldCandles: holdingCycles,
          protectionStage: 'NONE',
          highWaterPrice: numeric(finalEntry),
          highWaterR: 0,
          currentProfitR: 0,
          trailing_activated: false,
          assetTier: 'Tier 2',
          strategyId: signal.strategyId,
          slAlgoId,
          tpAlgoId,
          ownershipToken,
          entryOrderId,
          entryClientOrderId,
          slClientAlgoId,
          tpClientAlgoId,
          capitalAtEntryUsd: liveCapital,
          plannedEntryPrice: finalEntry
        });
        openTradeSupabaseIds.add(dbId);
      } else {
        for (const algoId of [slAlgoId, tpAlgoId].filter(Boolean)) {
          await sendBinanceReq(
            'DELETE',
            '/fapi/v1/algoOrder',
            { symbol, algoId }
          ).catch(() => {});
        }
        if (entryOrderId) {
          await sendBinanceReq(
            'DELETE',
            '/fapi/v1/order',
            { symbol, orderId: entryOrderId }
          ).catch(() => {});
        }
        throw new Error(
          `Không lưu được ledger ${symbol}; đã rollback các order đã biết`
        );
      }

      actionCooldowns.set(`${symbol}_${interval}`, Date.now());

      console.log(`[SCALP] ▶ ${symbol} ${signal.direction} [${interval}] ${signal.strategyId} Score=${signal.score} | E=${numeric(finalEntry).toFixed(2)} SL=${numeric(finalSl).toFixed(2)} TP=${numeric(finalTp).toFixed(2)} | Risk=$${actualRisk.toFixed(2)} (${actualRiskPct.toFixed(1)}%)`);
    } catch (e) {
      console.error(`[SCALP] Lỗi execute ${symbol}:`, e?.response?.data?.msg || e.message);
    }
  };

  const ensureInitialProtection = async (trade, position) => {
    const createdIds = [];
    const duplicateLegacyOrders = [];
    try {
      trade.ownershipToken =
        trade.ownershipToken ||
        makeTradeOwnershipToken(trade.supabaseId);
      trade.slClientAlgoId =
        trade.slClientAlgoId ||
        makeInitialClientAlgoId('sl', trade.ownershipToken);
      trade.tpClientAlgoId =
        trade.tpClientAlgoId ||
        makeInitialClientAlgoId('tp', trade.ownershipToken);
      const existingResponse = await sendBinanceReq(
        'GET',
        '/fapi/v1/openAlgoOrders',
        { symbol: trade.symbol },
        { priority: 'protection' }
      );
      const existingOrders = Array.isArray(existingResponse?.data)
        ? existingResponse.data
        : existingResponse?.data?.orders || [];
      const priceFilter = exchangeInfoCache?.symbols
        ?.find(item => item.symbol === trade.symbol)
        ?.filters?.find(filter =>
          filter.filterType === 'PRICE_FILTER'
        );
      const triggerTolerance =
        Math.max(numeric(priceFilter?.tickSize) / 2, 1e-12);
      const selectExisting = (
        type,
        expectedTrigger,
        storedAlgoId,
        clientAlgoId
      ) => {
        const exactIdentity = existingOrders.find(order =>
          order.symbol === trade.symbol &&
          (
            (
              storedAlgoId != null &&
              String(order.algoId) === String(storedAlgoId)
            ) ||
            (
              clientAlgoId &&
              order.clientAlgoId === clientAlgoId
            )
          )
        );
        const sameProtectionLane = existingOrders.filter(order => {
          const orderType = String(
            order.orderType ?? order.origType ?? order.type ?? ''
          ).toUpperCase();
          const orderQuantity = numeric(
            order.quantity ?? order.origQty
          );
          const quantityCompatible =
            orderQuantity <= 0 ||
            Math.abs(orderQuantity - numeric(trade.qty)) <
              Math.max(numeric(trade.qty) * 1e-6, 1e-12);
          return (
            order.symbol === trade.symbol &&
            order.side === trade.exitSide &&
            orderType === type &&
            quantityCompatible
          );
        });
        const exactTriggerMatches = sameProtectionLane.filter(
          order =>
            Math.abs(
              numeric(order.triggerPrice ?? order.stopPrice) -
              numeric(expectedTrigger)
            ) < triggerTolerance
        );
        const candidates =
          exactIdentity
            ? [exactIdentity]
            : exactTriggerMatches.length > 0
            ? exactTriggerMatches
            : sameProtectionLane;
        if (candidates.length > 0) {
          candidates.sort((left, right) =>
            numeric(
              right.createTime ?? right.updateTime ?? right.algoId
            ) -
            numeric(
              left.createTime ?? left.updateTime ?? left.algoId
            )
          );
          const selected = candidates[0];
          duplicateLegacyOrders.push(
            ...sameProtectionLane.filter(
              order => order !== selected
            )
          );
          console.log(
            `[SCALP] ${trade.symbol} nhận ownership ${sameProtectionLane.length} legacy ${type}; giữ algoId=${selected.algoId}`
          );
          return selected;
        }
        return null;
      };

      let protectedSl = selectExisting(
        'STOP_MARKET',
        trade.slPrice,
        trade.slAlgoId,
        trade.slClientAlgoId
      );
      let protectedTp = selectExisting(
        'TAKE_PROFIT_MARKET',
        trade.tpPrice,
        trade.tpAlgoId,
        trade.tpClientAlgoId
      );
      const create = async (type, triggerPrice, clientAlgoId) => {
        const response = await sendBinanceReq(
          'POST',
          '/fapi/v1/algoOrder',
          makePositionReductionPayload(position, {
            symbol: trade.symbol,
            side: trade.exitSide,
            type,
            triggerPrice,
            quantity: trade.qty,
            reduceOnly: 'true',
            workingType: 'MARK_PRICE',
            priceProtect: 'true',
            algoType: 'CONDITIONAL',
            clientAlgoId
          })
        );
        const algoId =
          response?.data?.algoId ?? response?.algoId ?? null;
        if (algoId != null) createdIds.push(algoId);
        return algoId;
      };

      const slAlgoId = protectedSl?.algoId ?? await create(
          'STOP_MARKET',
          trade.slPrice,
          trade.slClientAlgoId
        );
      const tpAlgoId = protectedTp?.algoId ?? await create(
          'TAKE_PROFIT_MARKET',
          trade.tpPrice,
          trade.tpClientAlgoId
        );
      const verifyResponse = await sendBinanceReq(
        'GET',
        '/fapi/v1/openAlgoOrders',
        { symbol: trade.symbol },
        { priority: 'protection' }
      );
      const openOrders = Array.isArray(verifyResponse?.data)
        ? verifyResponse.data
        : verifyResponse?.data?.orders || [];
      protectedSl = openOrders.find(order =>
        String(order.algoId) === String(slAlgoId) ||
        (
          trade.slClientAlgoId &&
          order.clientAlgoId === trade.slClientAlgoId
        )
      );
      protectedTp = openOrders.find(order =>
        String(order.algoId) === String(tpAlgoId) ||
        (
          trade.tpClientAlgoId &&
          order.clientAlgoId === trade.tpClientAlgoId
        )
      );
      if (!protectedSl || !protectedTp) {
        throw new Error('SL/TP mới chưa được Binance xác minh');
      }
      trade.slAlgoId = protectedSl.algoId;
      trade.tpAlgoId = protectedTp.algoId;
      trade.slPrice = String(
        numeric(protectedSl.triggerPrice ?? protectedSl.stopPrice) ||
        numeric(trade.slPrice)
      );
      trade.tpPrice = String(
        numeric(protectedTp.triggerPrice ?? protectedTp.stopPrice) ||
        numeric(trade.tpPrice)
      );
      for (const duplicate of duplicateLegacyOrders) {
        const cancelled = await sendBinanceReq(
          'DELETE',
          '/fapi/v1/algoOrder',
          { symbol: trade.symbol, algoId: duplicate.algoId }
        ).then(() => true).catch(error => {
          console.error(
            `[SCALP] Không xóa được legacy CO trùng ${trade.symbol} algoId=${duplicate.algoId}:`,
            formatApiError(error)
          );
          return false;
        });
        if (cancelled) {
          console.log(
            `[SCALP] ${trade.symbol} đã xóa legacy CO trùng algoId=${duplicate.algoId}`
          );
        }
      }
      return { slAlgoId: trade.slAlgoId, tpAlgoId: trade.tpAlgoId };
    } catch (error) {
      for (const algoId of createdIds) {
        await sendBinanceReq(
          'DELETE',
          '/fapi/v1/algoOrder',
          { symbol: trade.symbol, algoId }
        ).catch(() => {});
      }
      throw error;
    }
  };

  const replaceTradeStop = async (trade, triggerPrice, position) => {
    const symbol = trade.symbol;
    const openResponse = await sendBinanceReq(
      'GET',
      '/fapi/v1/openAlgoOrders',
      { symbol },
      { priority: 'protection' }
    );
    const openOrders = Array.isArray(openResponse?.data)
      ? openResponse.data
      : openResponse?.data?.orders || [];
    const existingStops = openOrders.filter(order => {
      const clientId = String(
        order.clientAlgoId ?? order.clientOrderId ?? ''
      );
      const type = String(
        order.orderType ?? order.origType ?? order.type ?? ''
      ).toUpperCase();
      return (
        order.symbol === symbol &&
        type.includes('STOP') &&
        (
          String(order.algoId) === String(trade.slAlgoId) ||
          clientId === trade.slClientAlgoId ||
          (
            trade.ownershipToken &&
            clientId.includes(trade.ownershipToken)
          )
        )
      );
    });
    const replacementClientId = makeClientAlgoId(
      trade.ownershipToken || trade.supabaseId
    );

    return replaceStopSafely({
      existingStops,
      createAndVerify: async () => {
        const createResponse = await sendBinanceReq(
          'POST',
          '/fapi/v1/algoOrder',
          makePositionReductionPayload(position, {
            symbol,
            side: trade.exitSide,
            type: 'STOP_MARKET',
            triggerPrice,
            quantity: trade.qty,
            reduceOnly: 'true',
            workingType: 'MARK_PRICE',
            priceProtect: 'true',
            algoType: 'CONDITIONAL',
            clientAlgoId: replacementClientId
          })
        );
        const createdId =
          createResponse?.data?.algoId ??
          createResponse?.algoId ??
          null;
        const verifyResponse = await sendBinanceReq(
          'GET',
          '/fapi/v1/openAlgoOrders',
          { symbol },
          { priority: 'protection' }
        );
        const verifiedOrders = Array.isArray(verifyResponse?.data)
          ? verifyResponse.data
          : verifyResponse?.data?.orders || [];
        return verifiedOrders.find(order =>
          (
            createdId != null &&
            String(order.algoId) === String(createdId)
          ) ||
          order.clientAlgoId === replacementClientId
        ) || null;
      },
      cancelOld: oldOrder => sendBinanceReq(
        'DELETE',
        '/fapi/v1/algoOrder',
        { symbol, algoId: oldOrder.algoId }
      ),
      isSameOrder: (left, right) =>
        String(left.algoId) === String(right.algoId)
    });
  };

  const monitorOpenTradesCycle = async () => {
    const positions = await getActivePositions('protection');
    if (!positions) return;
    const now = Date.now();
    const utcHour = toUtcHour();

    for (const [symbol, trade] of openTrades) {
      const pos = findPositionForTrade(positions, { symbol, direction: trade.direction });
      const posAmt = pos ? numeric(pos.positionAmt) : 0;

      if (posAmt === 0) {
        const elapsedMs = now - new Date(trade.openedAt).getTime();

        // Check if unfilled limit order timed out
        if (!trade.filledAt && elapsedMs >= 1200_000) {
          console.log(`[SCALP] ${symbol} lệnh chờ quá 20 phút chưa khớp, tiến hành hủy...`);
          if (trade.entryOrderId) {
            await sendBinanceReq(
              'DELETE',
              '/fapi/v1/order',
              { symbol, orderId: trade.entryOrderId }
            ).catch(() => {});
          }
          await cancelAlgoOrdersForTrade(trade);
          await deleteUnfilledTradeLog(trade.supabaseId);
          openTrades.delete(symbol);
          openTradeSupabaseIds.delete(trade.supabaseId);
          continue;
        }

        // Check if LIMIT order is still pending on Binance
        const openOrders = await getOpenOrders('protection');
        const stillPending = openOrders.some(o =>
          o.symbol === symbol &&
          (o.type === 'LIMIT' || o.type === 'LIMIT_MAKER') &&
          o.reduceOnly !== true &&
          o.reduceOnly !== 'true'
        );

        if (stillPending) {
          // Order still alive, waiting to fill — skip this cycle
          continue;
        }

        const entryOrderResponse =
          trade.entryOrderId || trade.entryClientOrderId
            ? await sendBinanceReq(
              'GET',
              '/fapi/v1/order',
              {
                symbol,
                ...(trade.entryOrderId
                  ? { orderId: trade.entryOrderId }
                  : {
                    origClientOrderId:
                      trade.entryClientOrderId
                  })
              }
            ).catch(() => null)
            : null;
        const entryOrder = entryOrderResponse?.data;
        const neverFilled =
          entryOrder &&
          ['CANCELED', 'REJECTED', 'EXPIRED'].includes(
            String(entryOrder.status).toUpperCase()
          ) &&
          numeric(entryOrder.executedQty) === 0;

        // No position and the exact entry is confirmed unfilled.
        if (neverFilled) {
          await cancelAlgoOrdersForTrade(trade);
          await deleteUnfilledTradeLog(trade.supabaseId);
          openTrades.delete(symbol);
          openTradeSupabaseIds.delete(trade.supabaseId);
          console.log(`[SCALP] ${symbol} LIMIT không khớp sau ${(elapsedMs/1000).toFixed(0)}s → hủy`);
          continue;
        }

        // Position was filled then closed — query trade history for PnL
        const holdingCycles = Math.max(
          1,
          Math.round(
            elapsedMs / INTERVAL_MS[trade.interval || '5m']
          )
        );

        // Xóa đúng CO của lệnh này (không xóa CO của lệnh mới cùng coin nếu có)
        const algoStates = await readAlgoStatesForTrade(trade);
        await cancelAlgoOrdersForTrade(trade);

        let pnlUsd = null;
        let realizedPnlGrossUsd = null;
        let commissionUsd = null;
        let fundingFeeUsd = null;
        let exitFill = null;
        try {
          const lifecycleStart = new Date(trade.openedAt).getTime();
          const tradesRes = await sendBinanceReq(
            'GET',
            '/fapi/v1/userTrades',
            {
              symbol,
              startTime: Math.max(0, lifecycleStart),
              limit: 1000
            }
          );
          if (tradesRes?.data && Array.isArray(tradesRes.data) && tradesRes.data.length > 0) {
            const exitSide = trade.direction === 'LONG' ? 'SELL' : 'BUY';
            const entryFills = tradesRes.data.filter(fill =>
              trade.entryOrderId != null &&
              String(fill.orderId) === String(trade.entryOrderId)
            );
            const entryBoundary = entryFills.length > 0
              ? Math.min(...entryFills.map(fill => numeric(fill.time)))
              : lifecycleStart;
            const exitFills = tradesRes.data
              .filter(fill =>
                String(fill.side || '').toUpperCase() === exitSide &&
                numeric(fill.time) >= entryBoundary
              )
              .sort((left, right) => numeric(left.time) - numeric(right.time));
            exitFill = exitFills.at(-1) || null;
            if (!exitFill) {
              throw new Error('exit fills chưa sẵn sàng');
            }
            realizedPnlGrossUsd = exitFills.reduce(
              (sum, fill) => sum + numeric(fill.realizedPnl),
              0
            );
            commissionUsd = [...entryFills, ...exitFills].reduce(
              (sum, fill) => sum + Math.abs(numeric(fill.commission)),
              0
            );
            const incomeEnd = numeric(exitFill?.time) || now;
            const incomeResponse = await sendBinanceReq(
              'GET',
              '/fapi/v1/income',
              {
                symbol,
                startTime: Math.max(
                  0,
                  Math.floor(entryBoundary / 1000) * 1000
                ),
                endTime: incomeEnd,
                limit: 1000
              }
            );
            const incomeRecords = Array.isArray(incomeResponse?.data)
              ? incomeResponse.data
              : [];
            fundingFeeUsd = incomeRecords
              .filter(record =>
                String(record.incomeType).toUpperCase() === 'FUNDING_FEE' &&
                numeric(record.time) >= entryBoundary &&
                numeric(record.time) <= incomeEnd
              )
              .reduce(
                (sum, record) => sum + numeric(record.income),
                0
              );
            pnlUsd =
              realizedPnlGrossUsd -
              commissionUsd +
              fundingFeeUsd;
          }
        } catch (error) {
          console.error(
            `[SCALP] Chưa đối soát được PnL ${symbol}:`,
            error.message
          );
        }

        const finalStatus =
          pnlUsd === null || Math.abs(pnlUsd) < 0.01 ? 'CLOSED' :
            pnlUsd > 0 ? 'WIN' : 'LOSS';
        const exitReason =
          pnlUsd === null
            ? 'PNL_RECONCILIATION_PENDING'
            : Math.abs(pnlUsd) < 0.01
              ? 'BREAKEVEN'
              : resolveScalpExitReason(trade, exitFill, algoStates);

        await updateTradeStatus(trade.supabaseId, {
          status: finalStatus,
          exit_reason: exitReason,
          holding_cycles: holdingCycles,
          pnl_usd: pnlUsd,
          realized_pnl_gross_usd: realizedPnlGrossUsd,
          commission_usd: commissionUsd,
          funding_fee_usd: fundingFeeUsd,
          pnl_attribution:
            pnlUsd === null
              ? 'PENDING'
              : 'BINANCE_TRADE_ID_NET_FEES_FUNDING_V1',
          close_price: exitFill ? numeric(exitFill.price) : null,
          closed_at: toISO(numeric(exitFill?.time) || now)
        });

        openTrades.delete(symbol);
        openTradeSupabaseIds.delete(trade.supabaseId);
        console.log(
          `[SCALP] ${symbol} đã đóng: ${finalStatus} | PnL=${pnlUsd === null ? 'pending' : `$${pnlUsd.toFixed(2)}`} | ${exitReason}`
        );
        continue;
      }

      // Position IS OPEN
      const actualEntry = numeric(pos.entryPrice);
      const filledQuantity = Math.abs(posAmt);
      const actualRiskUsd =
        filledQuantity *
        Math.abs(actualEntry - numeric(trade.initialSl));
      const actualRiskPct =
        numeric(trade.capitalAtEntryUsd) > 0
          ? actualRiskUsd / numeric(trade.capitalAtEntryUsd) * 100
          : null;
      if (
        Number.isFinite(actualRiskPct) &&
        actualRiskPct > CONFIG.safety.maxRiskPct
      ) {
        await marketClosePosition(
          symbol,
          trade.direction,
          String(filledQuantity),
          pos
        );
        await cancelAlgoOrdersForTrade(trade);
        await updateTradeStatus(trade.supabaseId, {
          status: 'CLOSED',
          actual_entry: actualEntry,
          risk_amount_usd: actualRiskUsd,
          applied_risk_pct: actualRiskPct,
          exit_reason: 'ACTUAL_FILL_RISK_LIMIT',
          closed_at: toISO(now)
        });
        openTrades.delete(symbol);
        openTradeSupabaseIds.delete(trade.supabaseId);
        continue;
      }
      if (!trade.slAlgoId || !trade.tpAlgoId) {
        try {
          trade.qty = String(Math.abs(posAmt));
          await ensureInitialProtection(trade, pos);
          await updateTradeStatus(trade.supabaseId, {
            ownership_token: trade.ownershipToken,
            sl_algo_id: trade.slAlgoId,
            tp_algo_id: trade.tpAlgoId,
            sl_client_algo_id: trade.slClientAlgoId,
            tp_client_algo_id: trade.tpClientAlgoId,
            sl: numeric(trade.slPrice),
            tp_1_price: numeric(trade.tpPrice),
            updated_at: toISO(now)
          });
        } catch (error) {
          console.error(
            `[SCALP] ${symbol} không xác minh đủ SL/TP; đóng fail-safe:`,
            error.message
          );
          await marketClosePosition(
            symbol,
            trade.direction,
            String(Math.abs(posAmt)),
            pos
          );
          await cancelAlgoOrdersForTrade(trade);
          await updateTradeStatus(trade.supabaseId, {
            status: 'CLOSED',
            exit_reason: 'PROTECTION_CREATION_FAILED',
            closed_at: toISO(now)
          });
          openTrades.delete(symbol);
          openTradeSupabaseIds.delete(trade.supabaseId);
          continue;
        }
      }
      if (!trade.filledAt) {
        const plannedEntry = numeric(
          trade.plannedEntryPrice || trade.entryPrice
        );
        trade.filledAt = toISO(now);
        trade.openedAt = trade.filledAt;
        trade.entryPrice = String(
          numeric(pos.entryPrice) || numeric(trade.entryPrice)
        );
        const capitalAtEntry = numeric(trade.capitalAtEntryUsd);
        await updateTradeStatus(trade.supabaseId, {
          status: 'OPEN',
          filled_at: trade.filledAt,
          opened_at: trade.filledAt,
          actual_entry: numeric(trade.entryPrice),
          entry: numeric(trade.entryPrice),
          position_size_usd:
            filledQuantity * numeric(trade.entryPrice),
          risk_amount_usd: actualRiskUsd,
          applied_risk_pct:
            capitalAtEntry > 0
              ? actualRiskUsd / capitalAtEntry * 100
              : null,
          slippage_usd:
            filledQuantity *
            Math.abs(numeric(trade.entryPrice) - plannedEntry),
          updated_at: trade.filledAt
        });
      }
      const unPnl = numeric(pos.unrealizedProfit);
      const markPrice = numeric(pos.markPrice);

      if (unPnl !== 0) {
        await updateTradeStatus(trade.supabaseId, {
          pnl_usd: numeric(unPnl),
          updated_at: new Date().toISOString()
        });
      }

      // 1. Calculate Scalp Trailing Decision (NONE -> BE -> LOCK -> TRAIL)
      const initialRiskPerCoin = Math.abs(numeric(trade.entryPrice) - numeric(trade.initialSl || trade.slPrice));
      const trailingDecision = calculateScalpTrailingDecision({
        entryPrice: numeric(trade.entryPrice),
        currentSl: numeric(trade.slPrice),
        markPrice,
        initialRiskPerCoin: initialRiskPerCoin > 0 ? initialRiskPerCoin : numeric(trade.entryPrice) * 0.01,
        direction: trade.direction,
        storedHighWater: trade.highWaterPrice ? numeric(trade.highWaterPrice) : null,
        protectionStage: trade.protectionStage || (trade.trailing_activated ? 'BE' : 'NONE'),
        strategyId: trade.strategyId || trade.strategy_name?.split(' ')[0] || 'S1_EMA_MOMENTUM',
        assetTier: trade.assetTier || 'Tier 2'
      });

      // Update high water tracking in memory
      trade.highWaterPrice = trailingDecision.highWaterPrice;
      trade.highWaterR = trailingDecision.highWaterR;
      trade.currentProfitR = trailingDecision.currentProfitR;

      const stageChanged = trailingDecision.nextStage !== (trade.protectionStage || 'NONE');
      let slUpdated = false;
      let replacementFailed = false;
      let newSlPriceStr = trade.slPrice;

      if (trailingDecision.targetSl !== null && Number.isFinite(trailingDecision.targetSl)) {
        const symInfo = exchangeInfoCache?.symbols.find(s => s.symbol === symbol);
        const tickSize = numeric(symInfo?.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize || '0.01');
        const formattedTargetSl = formatPrecision(trailingDecision.targetSl, tickSize);

        if (numeric(formattedTargetSl) !== numeric(trade.slPrice)) {
          // Verify SL improvement (LONG: new SL higher; SHORT: new SL lower)
          const isLong = trade.direction === 'LONG';
          const isImproved = isLong
            ? numeric(formattedTargetSl) > numeric(trade.slPrice)
            : numeric(formattedTargetSl) < numeric(trade.slPrice);

          if (isImproved) {
            newSlPriceStr = formattedTargetSl;
            slUpdated = true;
          }
        }
      }

      if (stageChanged || slUpdated) {
        console.log(`[SCALP] ${symbol} Trailing update: Stage ${trade.protectionStage || 'NONE'} -> ${trailingDecision.nextStage} | SL: ${trade.slPrice} -> ${newSlPriceStr} | HighWaterR=${trailingDecision.highWaterR.toFixed(2)}`);

        if (slUpdated) {
          try {
            // ORDER SAFETY RULE: Always POST new SL -> verify -> DELETE old SL, never cancel first
            const replacement = await replaceTradeStop(
              trade,
              newSlPriceStr,
              pos
            );
            trade.slAlgoId = replacement.algoId;
            trade.slClientAlgoId =
              replacement.clientAlgoId ??
              replacement.clientOrderId ??
              trade.slClientAlgoId;

            // Re-affirm TP order to keep TP active
          } catch (err) {
            replacementFailed = true;
            newSlPriceStr = trade.slPrice;
            console.error(`[SCALP] Lỗi cập nhật SL cho ${symbol}:`, err.message);
          }
        }

        if (replacementFailed) continue;
        trade.protectionStage = trailingDecision.nextStage;
        trade.slPrice = newSlPriceStr;
        trade.trailing_activated = trailingDecision.nextStage !== 'NONE';

        await updateTradeStatus(trade.supabaseId, {
          protection_stage: trailingDecision.nextStage,
          sl: numeric(newSlPriceStr),
          sl_algo_id: trade.slAlgoId,
          sl_client_algo_id: trade.slClientAlgoId,
          high_water_price: trailingDecision.highWaterPrice,
          high_water_r: trailingDecision.highWaterR,
          trailing_activated: trailingDecision.nextStage !== 'NONE',
          updated_at: new Date().toISOString()
        });
      }

      // 2. Calculate Scalp Temporal Barrier (+25% Soft Extension on LOCK/TRAIL with R >= 1.5R)
      const elapsedMs = now - new Date(trade.openedAt).getTime();
      const candlesPassed = Math.floor(
        elapsedMs / INTERVAL_MS[trade.interval || '5m']
      );

      let btcTrendAlignment = null;
      const btcCandles = htfCandleCache.get('BTCUSDT') || candleCache.get('BTCUSDT');
      if (btcCandles && btcCandles.length >= 20) {
        const lastBtc = btcCandles[btcCandles.length - 1].close;
        const btcSma20 = btcCandles.slice(-20).reduce((sum, c) => sum + c.close, 0) / 20;
        const isBtcBullish = lastBtc >= btcSma20;
        btcTrendAlignment = trade.direction === 'LONG' ? isBtcBullish : !isBtcBullish;
      }

      const barrierResult = calculateScalpTemporalBarrier({
        interval: trade.interval || '5m',
        tradeType: 'FUTURES',
        direction: trade.direction,
        assetTier: trade.assetTier || 'Tier 2',
        currentHourUTC: utcHour,
        strategyId: trade.strategyId || trade.strategy_name?.split(' ')[0] || 'S1_EMA_MOMENTUM',
        btcTrendAlignment,
        protectionStage: trade.protectionStage || 'NONE',
        currentProfitR: trailingDecision.currentProfitR,
        highWaterR: trailingDecision.highWaterR
      });

      const maxHoldingCycles = barrierResult.maxHoldingCycles;

      if (candlesPassed >= maxHoldingCycles) {
        console.log(`[SCALP] ${symbol} đạt giới hạn temporal barrier (${candlesPassed}/${maxHoldingCycles} nến, soft extension: ${barrierResult.softExtensionApplied}), đóng vị thế...`);
        const posAmt = Math.abs(numeric(pos.positionAmt));
        if (posAmt > 0) {
          await marketClosePosition(
            symbol,
            trade.direction,
            String(posAmt),
            pos
          );
        }
        await cancelAlgoOrdersForTrade(trade);

        const positionSizeUSD = numeric(pos.positionAmt) * markPrice;

        await updateTradeStatus(trade.supabaseId, {
          status:
            Math.abs(numeric(unPnl)) < 0.01 ? 'CLOSED' :
              numeric(unPnl) > 0 ? 'WIN' : 'LOSS',
          pnl_usd: numeric(unPnl),
          exit_reason: 'TEMPORAL_BARRIER_HIT',
          holding_cycles: candlesPassed,
          closed_at: toISO(now),
          position_size_usd: positionSizeUSD > 0 ? positionSizeUSD : numeric(trade.entryPrice) * numeric(trade.qty)
        });

        openTrades.delete(symbol);
        openTradeSupabaseIds.delete(trade.supabaseId);
      }
    }
  };

  const monitorOpenTrades = async () => {
    if (isMonitoring) return;
    isMonitoring = true;
    try {
      await monitorOpenTradesCycle();
    } catch (error) {
      console.error(
        '[SCALP] Lỗi monitor lifecycle:',
        formatApiError(error)
      );
    } finally {
      isMonitoring = false;
    }
  };

  const scanCounter = { count: 0 };

  const recordGateDecisions = decisions => {
    for (const decision of decisions) {
      if (decision.passed) continue;
      const key = `${decision.strategyId}:${decision.reason}`;
      gateRejectCounts.set(key, (gateRejectCounts.get(key) || 0) + 1);
    }
  };

  const scanSignals = async () => {
    if (isProcessing) {
      console.log('[SCALP] Bỏ qua scan: chu kỳ trước chưa kết thúc.');
      return;
    }
    isProcessing = true;
    let lastCapital = 0;

    try {
      if (
        lastWebsocketMessageAt > 0 &&
        !ensureWebsocketFresh()
      ) {
        throw new Error('WebSocket market data stale; scan fail-closed');
      }

      const [activePositions, pendingOrders, accountResponse] =
        await Promise.all([
          withTimeout(getActivePositions(), 'positionRisk'),
          withTimeout(getOpenOrders(), 'openOrders'),
          withTimeout(
            sendBinanceReq('GET', '/fapi/v2/account'),
            'account'
          )
        ]);
      const activeSymbols = new Set(
        activePositions
          .filter(position => CONFIG.coins.includes(position.symbol))
          .map(position => position.symbol)
      );
      const pendingSymbols = new Set(
        pendingOrders
          .filter(order =>
            order.reduceOnly !== true &&
            order.reduceOnly !== 'true' &&
            CONFIG.coins.includes(order.symbol)
          )
          .map(order => order.symbol)
      );
      const occupiedSymbols = new Set([
        ...activeSymbols,
        ...pendingSymbols,
        ...openTrades.keys()
      ]);
      const usedSlots = occupiedSymbols.size;
      if (usedSlots >= CONFIG.maxPositions) {
        return;
      }

      const rawMarginBalance = numeric(
        accountResponse?.data?.totalMarginBalance
      );
      const availableBalance = numeric(
        accountResponse?.data?.availableBalance
      );
      const liveCapital = Math.min(
        rawMarginBalance,
        CONFIG.maxCapital
      );
      lastCapital = liveCapital;
      const minimumMargin = Math.min(
        ...Object.values(CONFIG.intervals).map(
          config => CONFIG.marginPerTrade / config.leverage
        )
      );
      if (
        liveCapital <= 0 ||
        availableBalance < minimumMargin
      ) {
        console.log(
          `[SCALP] Không đủ margin thật: available=$${availableBalance.toFixed(2)}, capital cap=$${liveCapital.toFixed(2)}`
        );
        return;
      }

      let slotsAvailable = CONFIG.maxPositions - usedSlots;
      for (const symbol of CONFIG.coins) {
        if (slotsAvailable <= 0) break;
        if (occupiedSymbols.has(symbol)) continue;

        await Promise.all([
          loadMarketCandles(symbol, '5m', true),
          loadMarketCandles(symbol, '15m', true),
          loadMarketCandles(symbol, '1h', true),
          loadMarketCandles(symbol, '4h', true)
        ]);

        for (const interval of Object.keys(CONFIG.intervals)) {
          const candles = (
            intervalCaches.get(interval)?.get(symbol) || []
          ).filter(candle => candle.isClosed);
          const latest = candles.at(-1);
          if (!latest) continue;

          const evaluationKey = `${symbol}_${interval}`;
          if (
            lastEvaluatedCandle.get(evaluationKey) ===
            latest.closeTime
          ) {
            continue;
          }

          const lastFired = actionCooldowns.get(evaluationKey) || 0;
          if (
            Date.now() - lastFired <
            CONFIG.intervals[interval].cooldownMs
          ) {
            continue;
          }

          const htfInterval = interval === '1h' ? '4h' : '1h';
          const htfCandles = (
            intervalCaches.get(htfInterval)?.get(symbol) || []
          ).filter(candle => candle.isClosed);
          const marketContext = buildScalpMarketContext({
            candles,
            depthSnapshot: depthCache.get(symbol),
            intervalMs: INTERVAL_MS[interval]
          });
          const volumes = candles.map(candle => candle.volume);
          
          const { signals, decisions } =
            evaluateScalpSignalsWithDiagnostics(
              candles,
              volumes,
              learnedParams,
              htfCandles,
              marketContext,
              symbol
            );

          lastEvaluatedCandle.set(evaluationKey, latest.closeTime);
          recordGateDecisions(decisions);
          if (signals.length === 0) continue;

          const best = signals[0];
          console.log(
            `[SCALP] ${symbol} [${interval}] ${best.strategyId} ${best.direction} Score=${best.score}`
          );
          await executeScalpTrade(
            {
              ...best,
              gateDiagnostics: decisions.map(decision => ({
                strategyId: decision.strategyId,
                passed: decision.passed,
                reason: decision.reason,
                metrics: decision.metrics
              }))
            },
            symbol,
            liveCapital,
            interval
          );
          occupiedSymbols.add(symbol);
          slotsAvailable -= 1;
          break;
        }
      }
      lastSuccessfulScanAt = Date.now();
    } catch (error) {
      console.error('[SCALP] Lỗi scan:', formatApiError(error));
    } finally {
      scanCounter.count += 1;
      if (scanCounter.count % 12 === 0) {
        const topRejects = [...gateRejectCounts.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 8)
          .map(([reason, count]) => `${reason}=${count}`)
          .join(' | ');
        console.log(
          `[SCALP] DIAG #${scanCounter.count} | Trades=${openTrades.size} | Capital=$${lastCapital.toFixed(2)} | LastGoodScan=${lastSuccessfulScanAt ? new Date(lastSuccessfulScanAt).toISOString() : 'never'}`
        );
        if (topRejects) console.log(`[SCALP] Gate rejects: ${topRejects}`);
        gateRejectCounts.clear();
      }
      isProcessing = false;
    }
  };

  const enrichClosedScalpTrades = async () => {
    const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    try {
      const { data: rows, error } = await supabase
        .from('scalp_trade_logs')
        .select('*')
        .in('status', ['WIN', 'LOSS', 'CLOSED'])
        .eq('pee_analyzed', false)
        .lt('closed_at', cutoff)
        .limit(25);
      if (error) throw error;

      for (const trade of rows || []) {
        const startTime = new Date(
          trade.filled_at || trade.opened_at || trade.created_at
        ).getTime();
        const endTime = new Date(trade.closed_at).getTime();
        if (
          !Number.isFinite(startTime) ||
          !Number.isFinite(endTime) ||
          endTime <= startTime
        ) continue;

        const response = await readPublic('/fapi/v1/klines', {
          symbol: trade.symbol,
          interval: trade.interval || '5m',
          startTime,
          endTime,
          limit: 1500
        });
        const candles = (response?.data || []).map(kline =>
          normalizeRestKline(kline, endTime + 1)
        );
        if (candles.length === 0) continue;

        const entry = numeric(trade.actual_entry || trade.entry);
        const quantity =
          entry > 0 ? numeric(trade.position_size_usd) / entry : 0;
        const isLong =
          String(trade.direction).toUpperCase() === 'LONG';
        const favorablePrices = candles.map(candle =>
          isLong ? candle.high - entry : entry - candle.low
        );
        const adversePrices = candles.map(candle =>
          isLong ? entry - candle.low : candle.high - entry
        );
        const mfePerCoin = Math.max(0, ...favorablePrices);
        const maePerCoin = Math.max(0, ...adversePrices);
        const fillsResponse = await sendBinanceReq(
          'GET',
          '/fapi/v1/userTrades',
          {
            symbol: trade.symbol,
            startTime,
            endTime,
            limit: 1000
          }
        ).catch(error => {
          console.error(
            `[SCALP] Chưa đối soát fill ${trade.symbol} row=${trade.id}:`,
            error.message
          );
          return null;
        });
        const fills = Array.isArray(fillsResponse?.data)
          ? fillsResponse.data.filter(fill =>
            numeric(fill.time) >= startTime &&
            numeric(fill.time) <= endTime
          )
          : [];
        const grossPnl = fills.length > 0
          ? fills.reduce(
            (sum, fill) => sum + numeric(fill.realizedPnl),
            0
          )
          : null;
        const commission = fills.length > 0
          ? fills.reduce(
            (sum, fill) =>
              sum + Math.abs(numeric(fill.commission)),
            0
          )
          : null;
        const netPnl =
          grossPnl === null || commission === null
            ? null
            : grossPnl - commission;

        await updateTradeStatus(trade.id, {
          max_favorable_excursion_usd: mfePerCoin * quantity,
          max_adverse_excursion_usd: maePerCoin * quantity,
          pee_mfe_usd: mfePerCoin * quantity,
          pee_mae_usd: maePerCoin * quantity,
          pee_mfe_candles: candles.length,
          pee_analyzed: netPnl !== null,
          ...(netPnl === null ? {} : {
            realized_pnl_gross_usd: grossPnl,
            commission_usd: commission,
            pnl_usd: netPnl,
            pnl_attribution: 'SYMBOL_TIME_WINDOW_NET_FEES',
            status:
              Math.abs(netPnl) < 0.01 ? 'CLOSED' :
                netPnl > 0 ? 'WIN' : 'LOSS',
            exit_reason:
              trade.exit_reason === 'PNL_RECONCILIATION_PENDING'
                ? Math.abs(netPnl) < 0.01
                  ? 'BREAKEVEN'
                  : 'CLOSED_BY_TP_SL'
                : trade.exit_reason
          }),
          updated_at: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error(
        '[SCALP] Lỗi enrich lệnh đã đóng:',
        error.message
      );
    }
  };

  const recoverPendingTrades = async () => {
    try {
      // Recover PENDING + OPEN trades from scalp_trade_logs
      const { data, error } = await supabase
        .from('scalp_trade_logs')
        .select('*')
        .in('status', ['PENDING', 'OPEN']);
      if (error || !data) return;

      const positions = await getActivePositions('protection');
      if (!positions) return;
      let recovered = 0;

      for (const t of data) {
        const pos = findPositionForTrade(positions, { symbol: t.symbol, direction: t.direction });
        if (!pos) continue;

        openTrades.set(t.symbol, {
          supabaseId: t.id,
          openedAt: t.opened_at || t.created_at,
          filledAt:
            t.filled_at ||
            (t.status === 'OPEN' ? t.opened_at || t.created_at : null),
          symbol: t.symbol,
          interval: t.interval || '5m',
          qty: String(Math.abs(numeric(pos.positionAmt))),
          slPrice: String(t.sl),
          initialSl: String(t.initial_sl || t.sl),
          tpPrice: String(t.tp_1_price),
          entryPrice: String(pos.entryPrice || t.entry),
          direction: t.direction,
          side: t.direction === 'LONG' ? 'BUY' : 'SELL',
          exitSide: t.direction === 'LONG' ? 'SELL' : 'BUY',
          maxHoldCandles: t.holding_cycles || 12,
          protectionStage: t.protection_stage || (t.trailing_activated ? 'BE' : 'NONE'),
          highWaterPrice: numeric(t.high_water_price || pos.entryPrice || t.entry),
          highWaterR: numeric(t.high_water_r || 0),
          currentProfitR: 0,
          trailing_activated: t.trailing_activated || false,
          assetTier: t.asset_tier || 'Tier 2',
          strategyId: t.strategy_name?.split(' ')[0] || 'S1_EMA_MOMENTUM',
          ownershipToken: t.ownership_token,
          entryOrderId: t.entry_order_id,
          entryClientOrderId: t.entry_client_order_id,
          slAlgoId: t.sl_algo_id,
          tpAlgoId: t.tp_algo_id,
          slClientAlgoId: t.sl_client_algo_id,
          tpClientAlgoId: t.tp_client_algo_id,
          capitalAtEntryUsd: t.capital_at_entry_usd,
          plannedEntryPrice: t.entry
        });
        openTradeSupabaseIds.add(t.id);
        recovered++;
      }

      for (const pos of positions) {
        const sym = pos.symbol;
        if (!CONFIG.coins.includes(sym)) continue;
        if (openTrades.has(sym)) continue;

        console.log(`[SCALP] ⚠️ Vị thế ${sym} trên Binance (${pos.positionAmt} ${pos.entryPrice}) chưa được theo dõi. Có thể do bot khác hoặc manual.`);
      }

      if (recovered > 0) console.log(`[SCALP] 🔄 Đã khôi phục ${recovered} lệnh từ Database.`);
    } catch (e) {
      console.error('[SCALP] Lỗi khôi phục lệnh:', e.message);
    }
  };

  const init = async () => {
    console.log('[SCALP] ===== KHỞI ĐỘNG SCALP BOT =====');
    console.log(`[SCALP] Coin: ${CONFIG.coins.join(', ')}`);
    console.log(`[SCALP] Vốn max: $${CONFIG.maxCapital} | Margin/lệnh: $${CONFIG.marginPerTrade}`);
    console.log(`[SCALP] Khung: ${Object.keys(CONFIG.intervals).join(', ')}`);
    console.log(`[SCALP] Max lệnh: ${CONFIG.maxPositions}`);
    console.log('[SCALP] Chi tiết:');
    for (const [interval, cfg] of Object.entries(CONFIG.intervals)) {
      console.log(`  [${interval}] Leverage=${cfg.leverage}x | Risk=${cfg.riskPct}% | SL=${cfg.slATR}×ATR | TP=${cfg.tpATR}×ATR (${(cfg.tpATR/cfg.slATR).toFixed(1)}R) | MaxHold=${cfg.maxHoldCandles} nến | Cooldown=${cfg.cooldownMs / 1000}s`);
    }
    console.log('[SCALP] ================================');

    await verifyScalpLedgerSchema();
    await syncBinanceTime();
    await fetchExchangeInfo();
    await refreshScalpCoinPool();

    const startupPositions = await getActivePositions('protection');
    if (!startupPositions) {
      throw new Error(
        'Không đọc được vị thế Binance khi khởi động; bot không được phép chạy'
      );
    }
    const scalpPositions = startupPositions.filter(p => CONFIG.coins.includes(p.symbol));
    if (scalpPositions.length > 0) {
      const lines = scalpPositions.map(p => `  ${p.symbol} ${p.positionAmt} @ ${parseFloat(p.entryPrice).toFixed(2)}`).join('\n');
      console.log(`[SCALP] Vị thế hiện có:\n${lines}`);
    } else {
      console.log('[SCALP] Không có vị thế.');
    }

    await recoverPendingTrades();

    await Promise.all(
      CONFIG.coins.flatMap(symbol =>
        MARKET_INTERVALS.map(interval =>
          loadMarketCandles(symbol, interval)
        )
      )
    );

    learnedParams = await loadScalpParams(supabase);
    if (Object.keys(learnedParams).length > 0) {
      console.log(`[SCALP] Đã tải ${Object.keys(learnedParams).length} bộ tham số học máy.`);
    } else {
      console.log('[SCALP] Chưa có tham số học máy, dùng baseline.');
    }

    setInterval(syncBinanceTime, 300_000);
    setInterval(fetchExchangeInfo, 3600_000 * 6);
    setInterval(refreshScalpCoinPool, 1800_000); // 30 phút quét 1 lần

    setInterval(async () => {
      await runScalpOptimization(supabase);
      learnedParams = await loadScalpParams(supabase);
    }, 1800_000);

    await enrichClosedScalpTrades();
    setInterval(enrichClosedScalpTrades, 300_000);

    connectMarketWebSocket();

    setInterval(() => {
      ensureWebsocketFresh();
    }, CONFIG.websocketStaleMs);

    setInterval(async () => {
      await scanSignals();
    }, CONFIG.scanIntervalMs);

    setInterval(async () => {
      await monitorOpenTrades();
    }, 15_000);

    setInterval(() => {
      const activeCount = openTrades.size;
      const cdStatus = CONFIG.coins.filter(c => {
        const cd = actionCooldowns.get(`${c}_5m`) || 0;
        return Date.now() - cd < CONFIG.intervals['5m'].cooldownMs;
      }).map(c => `${c}:${Math.round((CONFIG.intervals['5m'].cooldownMs - (Date.now() - (actionCooldowns.get(`${c}_5m`) || 0))) / 1000)}s`).join(',');
      console.log(`[SCALP] ▲${activeCount} pos | ${CONFIG.coins.length} coins | ${openTrades.size} trades${cdStatus ? ' | CD: ' + cdStatus : ''}`);
    }, 60_000);
  };

  if (autoStart) {
    void init().catch(error => {
      console.error(
        '[SCALP FATAL] Khởi động thất bại:',
        error?.message || error
      );
    });
  }

  return {
    init,
    scanSignals,
    monitorOpenTrades,
    executeScalpTrade,
    getActivePositions,
    getOpenOrders,
    openTrades,
    candleCache,
    htfCandleCache,
    actionCooldowns,
    setExchangeInfo: (info) => { exchangeInfoCache = info; },
    getExchangeInfo: () => exchangeInfoCache,
    verifyScalpLedgerSchema
  };
}

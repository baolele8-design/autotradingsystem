import crypto from 'node:crypto';
import {
  isOwnedAlgoOrder,
  isStopLossOrder,
  isTakeProfitOrder,
  makeInitialClientAlgoId
} from '../../domain/orders/trailingOrders.js';
import {
  getStrategyDefinition,
  ROLLOUT_MODE
} from '../../../../src/domain/trading/strategyRouter.js';
import {
  evaluateNewEntrySymbol
} from '../../../../src/domain/trading/symbolEntryPolicy.js';
import {
  registerLedgerRoutes
} from './ledgerBridge.js';

const rejectExecution = (status, code, error) => ({
  ok: false,
  status,
  code,
  error
});

const BINANCE_PROXY_PATHS = new Set([
  '/api/v3/klines',
  '/api/v3/myTrades',
  '/api/v3/openOrders',
  '/fapi/v1/exchangeInfo',
  '/fapi/v1/klines',
  '/fapi/v1/openAlgoOrders',
  '/fapi/v1/openOrders',
  '/fapi/v1/ticker/24hr',
  '/fapi/v1/userTrades',
  '/fapi/v2/positionRisk'
]);

export function validateLiveExecutionStrategy({
  strategyId,
  strategyRolloutMode,
  direction,
  batchOrders
} = {}) {
  if (
    typeof strategyId !== 'string' ||
    strategyId.trim() === '' ||
    typeof strategyRolloutMode !== 'string' ||
    strategyRolloutMode.trim() === ''
  ) {
    return rejectExecution(
      400,
      'STRATEGY_METADATA_REQUIRED',
      'Thiếu strategyId hoặc strategyRolloutMode; từ chối đặt lệnh theo chế độ fail-closed.'
    );
  }

  const definition = getStrategyDefinition(strategyId.trim());
  if (!definition) {
    return rejectExecution(
      400,
      'UNKNOWN_STRATEGY',
      'strategyId không tồn tại trong catalog chiến thuật của daemon.'
    );
  }

  if (strategyRolloutMode !== definition.rolloutMode) {
    return rejectExecution(
      409,
      'STRATEGY_ROLLOUT_MISMATCH',
      'strategyRolloutMode không khớp catalog chiến thuật của daemon.'
    );
  }

  if (definition.rolloutMode !== ROLLOUT_MODE.LIVE) {
    return rejectExecution(
      403,
      'PAPER_ONLY_STRATEGY',
      'Chiến thuật PAPER_ONLY không được phép gửi lệnh thật lên Binance.'
    );
  }

  if (
    (direction !== 'LONG' && direction !== 'SHORT') ||
    !definition.supportedDirections.includes(direction)
  ) {
    return rejectExecution(
      400,
      'STRATEGY_DIRECTION_MISMATCH',
      'Hướng lệnh không nằm trong supportedDirections của chiến thuật.'
    );
  }

  const expectedEntrySide = direction === 'LONG' ? 'BUY' : 'SELL';
  const actualEntrySide =
    typeof batchOrders?.[0]?.side === 'string'
      ? batchOrders[0].side.toUpperCase()
      : '';
  if (actualEntrySide !== expectedEntrySide) {
    return rejectExecution(
      400,
      'ORDER_DIRECTION_MISMATCH',
      'Side của lệnh entry không khớp direction đã được xác minh.'
    );
  }

  return {
    ok: true,
    strategy: definition
  };
}

export function registerRoutes(context) {
  const {
    app,
    broadcastLedgerChanged,
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
  } = context;

  app.post('/api/mvrv', (req, res) => {
    if (req.body.mvrvZScore !== undefined) {
      const mvrvZScore = parseFloat(req.body.mvrvZScore);
      setGlobalMvrvZScore(mvrvZScore, {
        fetchedAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
        source: 'manual',
        stale: false
      });
      console.log(
        `[SYNC] Đã cập nhật MVRV-Z Score: ${mvrvZScore}`
      );
    }
    res.status(200).json({ success: true });
  });

  app.get('/api/mvrv', (_req, res) => {
    res.status(200).json(getMvrvState());
  });

  app.get('/api/system-health', (_req, res) => {
    res.status(200).json({
      binance: getRateLimitState()
    });
  });

  app.get('/api/btc-regime', (_req, res) => {
    // O10 (team-D 2026-08-12): expose fixed 4h/1d BTC regime state read
    // from the latest scanner cycle (see matrixScannerService getter).
    const snapshot = typeof getBtcRegimeSnapshot === 'function'
      ? getBtcRegimeSnapshot()
      : null;
    res.status(200).json({
      success: true,
      data: snapshot,
      timestamp: new Date().toISOString()
    });
  });

  app.post('/api/execute-batch', async (req, res) => {
      try {
          const {
            symbol,
            leverage,
            marginType,
            batchOrders,
            tradeType,
            strategyId,
            strategyRolloutMode,
            direction
          } = req.body || {};
          if (!Array.isArray(batchOrders) || batchOrders.length === 0) {
              return res.status(400).json({ error: 'Lệnh rỗng.' });
          }

          const executionPolicy = validateLiveExecutionStrategy({
            strategyId,
            strategyRolloutMode,
            direction,
            batchOrders
          });
          if (!executionPolicy.ok) {
              return res.status(executionPolicy.status).json({
                  error: executionPolicy.error,
                  code: executionPolicy.code
              });
          }

          const symbolPolicy = evaluateNewEntrySymbol(symbol);
          if (!symbolPolicy.allowed) {
              return res.status(403).json({
                error: `Blocked new entry for ${symbolPolicy.symbol || 'empty symbol'}.`,
                code: 'BLOCKED_NEW_ENTRY_SYMBOL',
                rule: symbolPolicy.code
              });
          }
  
          let hedgeMode = false;
          let intendedPositionSide = 'BOTH';
  
          if (tradeType !== 'SPOT') {
              try { await sendBinanceReq('POST', '/fapi/v1/marginType', { symbol, marginType }); } catch { /* existing best-effort policy */ }
              try { await sendBinanceReq('POST', '/fapi/v1/leverage', { symbol, leverage }); } catch { /* existing best-effort policy */ }
  
              const positionMode = await readBinanceReq('/fapi/v1/positionSide/dual');
              if (!positionMode || positionMode.dualSidePosition === undefined) {
                  throw new Error('Không xác minh được Position Mode; từ chối đặt lệnh để tránh tạo SL sai phía.');
              }
  
              hedgeMode =
                  positionMode.dualSidePosition === true ||
                  positionMode.dualSidePosition === 'true';
              intendedPositionSide = hedgeMode
                  ? (batchOrders[0]?.side === 'BUY' ? 'LONG' : 'SHORT')
                  : 'BOTH';
          }
  
          const results = [];
          const batchToken = crypto.randomUUID().replaceAll('-', '').slice(0, 20);
          for (let i = 0; i < batchOrders.length; i++) {
              const orderPayload = { ...batchOrders[i] };
              try {
                  let endpoint = '/fapi/v1/order';
  
                  if (tradeType === 'SPOT') {
                      endpoint = '/api/v3/order';
                      if (['STOP_LOSS', 'TAKE_PROFIT'].includes(orderPayload.type)) {
                          endpoint = '/sapi/v1/algo/spot/newOrderAlgo';
                          orderPayload.algoType = orderPayload.type; 
                          delete orderPayload.type; 
                      }
                  } else {
                      if (hedgeMode) {
                          orderPayload.positionSide = intendedPositionSide;
                          delete orderPayload.reduceOnly;
                      }
  
                      if (['STOP_MARKET', 'TAKE_PROFIT_MARKET'].includes(orderPayload.type)) {
                          endpoint = '/fapi/v1/algoOrder';
                          orderPayload.algoType = 'CONDITIONAL';
                          orderPayload.clientAlgoId =
                              orderPayload.clientAlgoId ||
                              makeInitialClientAlgoId(
                                  orderPayload.type === 'STOP_MARKET' ? 'sl' : 'tp',
                                  `${batchToken}${i}`
                              );
                      }
                  }
  
                  const response = tradeType === 'SPOT'
                      ? await sendSpotBinanceReq('POST', endpoint, orderPayload)
                      : await sendBinanceReq('POST', endpoint, orderPayload);
  
                  results.push(response.data);
              } catch (err) {
                  if (i === 0) {
                      throw new Error(
                          `Lệnh Entry bị từ chối: ${err.response?.data?.msg || err.message}`,
                          { cause: err }
                      );
                  }
                  results.push({ error: true, type: orderPayload.type || orderPayload.algoType, msg: err.response?.data?.msg || err.message });
              }
          }
          return res.status(200).json(results);
      } catch (error) {
          return res.status(500).json({ error: 'Bridge Execution Failed', details: { msg: error.message } });
      }
  });
  
  app.delete('/api/cancel-orphans', async (req, res) => {
      try {
          const { symbol } = req.body;
          if (!symbol) return res.status(400).json({ error: "Thiếu symbol." });
          const cleanupResult = await withSymbolOrderLock(symbol, async () => {
              const [openOrdersRes, openAlgoOrdersRes] = await Promise.all([
                  sendBinanceReq('GET', '/fapi/v1/openOrders', { symbol }),
                  sendBinanceReq('GET', '/fapi/v1/openAlgoOrders', { symbol })
              ]);
              const openOrders = [
                  ...(Array.isArray(openOrdersRes.data) ? openOrdersRes.data : []),
                  ...(Array.isArray(openAlgoOrdersRes.data) ? openAlgoOrdersRes.data : [])
              ];
              const orphanOrders = openOrders.filter(order =>
                  isOwnedAlgoOrder(order) &&
                  (isStopLossOrder(order) || isTakeProfitOrder(order))
              );
  
              for (const order of orphanOrders) {
                  try { await cancelExactOrder(symbol, order); } catch { /* existing best-effort policy */ }
              }
              return { count: orphanOrders.length };
          });
  
          if (cleanupResult?.skipped) {
              return res.status(202).json({
                  success: true,
                  message: 'Symbol đang được xử lý; cleanup sẽ thử lại.'
              });
          }
          return res.status(200).json({
              success: true,
              count: cleanupResult?.count || 0
          });
      } catch (error) {
          return res.status(500).json({ error: 'Failed to clear orphans', details: { msg: error.message } });
      }
  });
  
  app.post('/api/binance', async (req, res) => {
      if (req.body.action === 'SIGN_TRADFI') {
          try {
              const response = await sendBinanceReq('POST', '/fapi/v1/stock/contract');
              res.status(response.status).json(response.data);
          } catch (err) { res.status(500).json({ error: err.message }); }
      } else res.status(400).json({ error: 'Invalid Action' });
  });
  
  app.get('/api/binance', async (req, res) => {
      try {
          const { path, isPrivate, ...restQuery } = req.query;
          delete restQuery.t;
          const validPath = typeof path === 'string' &&
              BINANCE_PROXY_PATHS.has(path);
          if (!validPath) {
              return res.status(400).json({ error: 'Invalid Binance path' });
          }

          const isFutures = path.startsWith('/fapi/') || path.startsWith('/futures/');
          let data;
          if (isPrivate === 'true') {
              data = isFutures
                  ? await readBinanceReq(path, restQuery, { ttlMs: 0 })
                  : await readSpotBinanceReq(path, restQuery, { ttlMs: 0 });
          } else {
              const origin = isFutures
                  ? 'https://fapi.binance.com'
                  : 'https://api.binance.com';
              const queryString = new URLSearchParams(restQuery).toString();
              data = await safeFetch(
                  `${origin}${path}${queryString ? `?${queryString}` : ''}`,
                  { ttlMs: 0 }
              );
          }

          const rateState = getRateLimitState();
          if (rateState.usedWeight1m !== undefined) {
              res.setHeader('x-mbx-used-weight-1m', String(rateState.usedWeight1m));
          }
          return data === null
              ? res.status(503).json({ error: 'Binance request unavailable' })
              : res.status(200).json(data);
      } catch (err) { res.status(500).json({ error: err.message }); }
  });
  
  app.get('/api/cmc', async (req, res) => {
      try {
          const [globalRes, fgiRes] = await Promise.all([
            fetch('https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD'),
            fetch('https://pro-api.coinmarketcap.com/public-api/v3/fear-and-greed/latest')
          ]);
          const globalData = await globalRes.json();
          const fgiData = await fgiRes.json();
          res.status(200).json({
            btcDominance: globalData.data?.btc_dominance || 55.0,
            fgiValue: fgiData.data?.value || 50
          });
      } catch (err) { res.status(500).json({ error: err.message }); }
  });
  
  app.post('/api/gemini', async (req, res) => {
      try {
          const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
              body: JSON.stringify(req.body)
          });
          res.status(response.status).json(await response.json());
      } catch (err) { res.status(500).json({ error: err.message }); }
  });
  
app.delete('/api/cancel-all', async (req, res) => {
      try {
          const { symbol } = req.body;
          if (!symbol) return res.status(400).json({ error: "Thiếu symbol." });
          const response = await sendBinanceReq('DELETE', '/fapi/v1/allOpenOrders', { symbol });
          return res.status(200).json({ success: true, data: response.data });
      } catch (error) {
          return res.status(500).json({ error: 'Failed to clear orders', details: { msg: error.message } });
      }
  });

  registerLedgerRoutes({ app, supabase, broadcastLedgerChanged });
}

import {
  PROTECTION_STAGE_RANK,
  calculateTrailingDecision,
  resolveOptimizedTrailingPolicy
} from '../../../../src/domain/trading/trailingPolicy.js';
import {
  findPositionForTrade,
  isOwnedAlgoOrder,
  isSameTriggerPrice,
  isStopTriggerAdmissible,
  isStopLossOrder,
  isStrictlyBetterStop,
  isTakeProfitOrder,
  makeClientAlgoId,
  makeExitClientOrderId,
  makePositionReductionPayload,
  quantizeStopPrice,
  replaceStopSafely,
  selectReplaceableStopOrders
} from '../../domain/orders/trailingOrders.js';
import {
  computeGreenTotal,
  isEngineOwnedPosition,
  shouldTriggerPortfolioTp
} from '../../domain/execution/portfolioTakeProfit.js';
import {
  BTC_BREAK_BURST_LIMIT,
  BTC_BREAK_LOOKBACK_N,
  EXIT_REASON_BTC_BREAK,
  computeBtcBreakCapStop,
  createBtcBreakCooldown,
  evaluateBtcBreak,
  selectBtcBreakSymbols
} from '../../domain/execution/btcBreakProtection.js';

const INTERVAL_MS = {
  '5m': 300000,
  '15m': 900000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000
};

export function createProtectionService(context) {
  const {
    getCurrentAiModel = () => null,
    markPriceCache,
    marketDataCache = null,
    observeOpenTrades = () => {},
    readBinanceReq,
    safeFetch,
    sendBinanceReq,
    supabase
  } = context;

  const exchangePriceFilters = new Map();
  const symbolOrderLocks = new Set();
  const crossedTargetLoggedAt = new Map();
  const btcBreakCooldown = createBtcBreakCooldown();
  let exchangePriceFiltersLoadedAt = 0;

  async function withSymbolOrderLock(symbol, operation) {
      if (symbolOrderLocks.has(symbol)) {
          return { skipped: true };
      }
  
      symbolOrderLocks.add(symbol);
      try {
          return await operation();
      } finally {
          symbolOrderLocks.delete(symbol);
      }
  }
  
  async function loadExchangePriceFilters(force = false) {
      const cacheIsFresh =
          Date.now() - exchangePriceFiltersLoadedAt < 6 * 60 * 60 * 1000;
      if (!force && cacheIsFresh && exchangePriceFilters.size > 0) return true;
  
      const exchangeInfo = await safeFetch(
          'https://fapi.binance.com/fapi/v1/exchangeInfo',
          { priority: 'protection' }
      );
      if (!exchangeInfo || !Array.isArray(exchangeInfo.symbols)) return false;
  
      const nextFilters = new Map();
      for (const symbolInfo of exchangeInfo.symbols) {
          const priceFilter = symbolInfo.filters?.find(
              filter => filter.filterType === 'PRICE_FILTER'
          );
          if (priceFilter?.tickSize) {
              nextFilters.set(symbolInfo.symbol, {
                  minPrice: priceFilter.minPrice,
                  maxPrice: priceFilter.maxPrice,
                  tickSize: priceFilter.tickSize
              });
          }
      }
  
      if (nextFilters.size === 0) return false;
      exchangePriceFilters.clear();
      for (const [symbol, filter] of nextFilters) {
          exchangePriceFilters.set(symbol, filter);
      }
      exchangePriceFiltersLoadedAt = Date.now();
      return true;
  }
  
  async function readSymbolOpenOrders(symbol) {
      const [standardOrdersRes, algoOrdersRes] = await Promise.all([
          readBinanceReq('/fapi/v1/openOrders', { symbol }, { priority: 'protection' }),
          readBinanceReq('/fapi/v1/openAlgoOrders', { symbol }, { priority: 'protection' })
      ]);
  
      const standardOrders = Array.isArray(standardOrdersRes) ? standardOrdersRes : (standardOrdersRes?.orders || []);
      const algoOrders = Array.isArray(algoOrdersRes) ? algoOrdersRes : (algoOrdersRes?.orders || []);

      return [...standardOrders, ...algoOrders];
  }
  
  async function verifyAlgoOrder(symbol, createdOrder, clientAlgoId) {
      const algoId = createdOrder?.algoId;
  
      for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) {
              await new Promise(resolve => setTimeout(resolve, 150 * attempt));
          }
  
          if (algoId !== undefined && algoId !== null) {
              const queried = await readBinanceReq('/fapi/v1/algoOrder', {
                  symbol,
                  algoId
              }, { priority: 'protection' });
              if (
                  queried &&
                  String(queried.algoStatus || '').toUpperCase() === 'NEW'
              ) {
                  return queried;
              }
          }
  
          const openOrders = await readBinanceReq('/fapi/v1/openAlgoOrders', {
              symbol
          }, { priority: 'protection' });
          if (Array.isArray(openOrders)) {
              const verified = openOrders.find(order =>
                  (algoId !== undefined && String(order.algoId) === String(algoId)) ||
                  order.clientAlgoId === clientAlgoId
              );
              if (verified) return verified;
          }
      }
      return null;
  }
  
  async function cancelExactOrder(symbol, order) {
      if (order.algoId !== undefined && order.algoId !== null) {
          await sendBinanceReq('DELETE', '/fapi/v1/algoOrder', {
              symbol,
              algoId: order.algoId
          });
          return;
      }
  
      if (order.orderId !== undefined && order.orderId !== null) {
          await sendBinanceReq('DELETE', '/fapi/v1/order', {
              symbol,
              orderId: order.orderId
          });
      }
  }
  
  async function persistTrailingState(tradeId, update) {
      const { error } = await supabase
          .from('trade_logs')
          .update(update)
          .eq('id', tradeId);
      if (error) throw new Error(`Supabase update failed: ${error.message}`);
  }

  // MARKET close + hủy SL/TP conditional orders còn treo của lệnh.
  async function closePositionAndCleanup({ position, trade, side, newClientOrderId }) {
      const closeQty = Math.abs(Number.parseFloat(position.positionAmt));
      await sendBinanceReq(
          'POST',
          '/fapi/v1/order',
          makePositionReductionPayload(position, {
              symbol: trade.symbol,
              side,
              type: 'MARKET',
              quantity: closeQty,
              newClientOrderId
          })
      );
      try {
          const remainingOrders =
              await readSymbolOpenOrders(trade.symbol);
          if (remainingOrders) {
              for (const order of remainingOrders) {
                  if (
                      isOwnedAlgoOrder(order) &&
                      (
                          isStopLossOrder(order) ||
                          isTakeProfitOrder(order)
                      )
                  ) {
                      await cancelExactOrder(
                          trade.symbol,
                          order
                      );
                  }
              }
          }
      } catch (cleanupError) {
          console.error(
              `[PORTFOLIO TP CLEANUP] ${trade.symbol}:`,
              cleanupError.response?.data?.msg ||
              cleanupError.message
          );
      }
  }
  
  async function runSmartTrailingEngine() {
      try {
          const { data: queriedTrades, error: openTradesError } = await supabase
              .from('trade_logs')
              .select('*')
              .eq('status', 'OPEN')
              .eq('type', 'FUTURES');
  
          if (openTradesError) {
              throw new Error(`Không đọc được open trades: ${openTradesError.message}`);
          }
          if (!queriedTrades || queriedTrades.length === 0) {
              observeOpenTrades([]);
              return;
          }
          observeOpenTrades(queriedTrades);
  
          const filtersReady = await loadExchangePriceFilters();
          if (!filtersReady) {
              console.error('[TRAILING FAIL-CLOSED] Không nạp được PRICE_FILTER.');
              return;
          }
  
          const positionsRes = await readBinanceReq(
              '/fapi/v2/positionRisk',
              {},
              { priority: 'protection' }
          );
          if (!Array.isArray(positionsRes)) return;

          const portfolioClosedTradeIds = new Set();

          const { totalGreen, candidates } = computeGreenTotal(
              positionsRes,
              queriedTrades
          );
          if (shouldTriggerPortfolioTp(totalGreen)) {
              for (const candidate of candidates) {
                  const position = positionsRes.find(p => p.symbol === candidate.symbol);
                  const trade = queriedTrades.find(t =>
                      t.symbol === candidate.symbol && t.status === 'OPEN'
                  );
                  if (!position || !trade) continue;
                  try {
                      const mutationResult = await withSymbolOrderLock(
                          candidate.symbol,
                          () => closePositionAndCleanup({
                              position,
                              trade,
                              side: trade.direction === 'LONG' ? 'SELL' : 'BUY',
                              newClientOrderId: makeExitClientOrderId(
                                  'portfolio-tp',
                                  trade.id
                              )
                          })
                      );
                      if (mutationResult?.skipped) {
                          console.log(
                              `[PORTFOLIO TP SKIP] ${candidate.symbol} đang có mutation khác; thử lại vòng sau.`
                          );
                          continue;
                      }

                      await persistTrailingState(trade.id, {
                          status: 'CLOSED',
                          close_price:
                              markPriceCache.get(candidate.symbol)?.price ??
                              position.markPrice,
                          exit_reason: 'PORTFOLIO_TP'
                      });
                      portfolioClosedTradeIds.add(trade.id);
                      console.log(
                          `🎯 [PORTFOLIO TP] Đã chốt ${candidate.symbol} ` +
                          `+$${candidate.pnl.toFixed(2)} (tổng lời $${totalGreen.toFixed(2)}).`
                      );
                  } catch (error) {
                      console.error(
                          `❌ [PORTFOLIO TP] Không chốt được ${candidate.symbol}:`,
                          error.response?.data?.msg || error.message
                      );
                  }
              }
          }

          // F-D3: vị thế ĐỎ engine-owned (unrealizedProfit <= 0) — nhánh cap SL.
          const redCandidates = positionsRes.filter(position =>
              isEngineOwnedPosition(position, queriedTrades) &&
              Number.parseFloat(position.unrealizedProfit) <= 0
          );

          // =====================================================================
          // 🚨 BTC BREAK PROTECTION (A2/A1 + F-D3): BTC đảo chiều phá
          // support/resistance 5m → đóng green positions cùng chiều rủi ro
          // (LONG khi phá support, SHORT khi phá resistance) VÀ cap SL lệnh
          // đỏ cùng chiều rủi ro về 1R (không đóng). One-shot 4h global;
          // LIVE — thao tác lệnh thật khi break xác nhận (owner directive
          // 2026-08-12, bỏ shadow). Fail-closed: thiếu marketDataCache /
          // klines lỗi / stale → không đụng gì.
          // =====================================================================
          if (
              marketDataCache &&
              (candidates.length > 0 || redCandidates.length > 0) &&
              btcBreakCooldown.canTrigger()
          ) {
              try {
                  const btcKlines = await marketDataCache.getKlines(
                      'BTCUSDT',
                      '5m',
                      BTC_BREAK_LOOKBACK_N + 5
                  );
                  const btcBreak = evaluateBtcBreak({ klines: btcKlines });
                  if (btcBreak.kind) {
                      const breakSymbols = selectBtcBreakSymbols(
                          candidates,
                          queriedTrades,
                          btcBreak.kind
                      );
                      const closeable = breakSymbols
                          .map(candidate => ({
                              candidate,
                              trade: queriedTrades.find(t =>
                                  t.symbol === candidate.symbol &&
                                  t.status === 'OPEN'
                              )
                          }))
                          .filter(({ trade }) =>
                              trade && !portfolioClosedTradeIds.has(trade.id)
                          )
                          .slice(0, BTC_BREAK_BURST_LIMIT);

                      for (const { candidate, trade } of closeable) {
                          const position = positionsRes.find(
                              p => p.symbol === candidate.symbol
                          );
                          if (!position || !trade) continue;
                          try {
                              const mutationResult = await withSymbolOrderLock(
                                  candidate.symbol,
                                  () => closePositionAndCleanup({
                                      position,
                                      trade,
                                      side: trade.direction === 'LONG' ? 'SELL' : 'BUY',
                                      newClientOrderId: makeExitClientOrderId(
                                          'portfolio-btc',
                                          trade.id
                                      )
                                  })
                              );
                              if (mutationResult?.skipped) {
                                  console.log(
                                      `[BTC BREAK SKIP] ${candidate.symbol} đang có mutation khác; thử lại vòng sau.`
                                  );
                                  continue;
                              }

                              await persistTrailingState(trade.id, {
                                  status: 'CLOSED',
                                  close_price:
                                      markPriceCache.get(candidate.symbol)?.price ??
                                      position.markPrice,
                                  exit_reason: EXIT_REASON_BTC_BREAK
                              });
                              portfolioClosedTradeIds.add(trade.id);
                              console.log(
                                  `🚨 [BTC BREAK] Đã chốt ${candidate.symbol} ` +
                                  `do ${btcBreak.kind} (${btcBreak.kind === 'SUPPORT_BREAK' ? 'LONG' : 'SHORT'} rủi ro).`
                              );
                          } catch (error) {
                              console.error(
                                  `❌ [BTC BREAK] Không chốt được ${candidate.symbol}:`,
                                  error.response?.data?.msg || error.message
                              );
                          }
                      }

                      // F-D3 red-cap loop: vị thế ĐỎ cùng chiều rủi ro → cap SL
                      // về 1R (KHÔNG đóng; không đụng protection_stage /
                      // high_water_price / trailing_activated / exit_reason /
                      // status). Create+verify trước, delete sau — mirror
                      // trailing pattern. Fail-closed từng bước: mark không
                      // fresh, cap không tính được, thiếu filter, tick lỗi,
                      // monotonic, inadmissible, foreign stop → skip.
                      const wantedDirection =
                          btcBreak.kind === 'SUPPORT_BREAK'
                              ? 'LONG'
                              : btcBreak.kind === 'RESISTANCE_BREAK'
                                  ? 'SHORT'
                                  : null;
                      const capableRed = selectBtcBreakSymbols(
                          redCandidates,
                          queriedTrades,
                          btcBreak.kind
                      ).slice(0, BTC_BREAK_BURST_LIMIT);

                      for (const candidate of capableRed) {
                          // candidate chính là position object (từ
                          // redCandidates = positionsRes.filter) — không
                          // re-find theo symbol để tránh nhầm position khác
                          // chiều trong hedge mode.
                          const position = candidate;
                          const positionDirection =
                              Number.parseFloat(position.positionAmt) > 0
                                  ? 'LONG'
                                  : 'SHORT';
                          if (positionDirection !== wantedDirection) continue;
                          const trade = queriedTrades.find(t =>
                              t.symbol === candidate.symbol &&
                              t.status === 'OPEN' &&
                              String(t.direction || '').toUpperCase() ===
                                  positionDirection
                          );
                          if (!trade) continue;
                          if (portfolioClosedTradeIds.has(trade.id)) continue;

                          const entryPrice = Number.parseFloat(trade.entry);
                          const currentSl = Number.parseFloat(trade.sl);
                          const initialRiskPerCoin =
                              Number.parseFloat(trade.initial_risk_per_coin);
                          if (
                              !Number.isFinite(entryPrice) || entryPrice <= 0 ||
                              !Number.isFinite(currentSl) || currentSl <= 0 ||
                              !Number.isFinite(initialRiskPerCoin) ||
                              initialRiskPerCoin <= 0
                          ) {
                              console.error(
                                  `[BTC BREAK CAP SKIP] ${trade.symbol}: entry/sl/initial_risk_per_coin không hợp lệ.`
                              );
                              continue;
                          }

                          const cachedMark = markPriceCache.get(trade.symbol);
                          const hasFreshStreamPrice =
                              cachedMark &&
                              Date.now() - cachedMark.updatedAt <= 5000;
                          if (!hasFreshStreamPrice) {
                              console.warn(
                                  `[BTC BREAK CAP SKIP] ${trade.symbol}: markPriceCache không fresh; bỏ qua cap (không fallback position.markPrice).`
                              );
                              continue;
                          }
                          const markPrice = cachedMark.price;

                          const capSl = computeBtcBreakCapStop({
                              entry: entryPrice,
                              initialRiskPerCoin,
                              direction: trade.direction
                          });
                          if (capSl === null) continue;

                          const priceFilter = exchangePriceFilters.get(trade.symbol);
                          if (!priceFilter) {
                              console.error(
                                  `[BTC BREAK CAP FAIL-CLOSED] Thiếu PRICE_FILTER cho ${trade.symbol}.`
                              );
                              continue;
                          }

                          const isLong = trade.direction === 'LONG';
                          let quantized;
                          try {
                              quantized = quantizeStopPrice(
                                  capSl,
                                  priceFilter,
                                  isLong
                              );
                          } catch (error) {
                              console.error(
                                  `[BTC BREAK CAP TICK] ${trade.symbol}:`,
                                  error.message
                              );
                              continue;
                          }

                          if (!isStrictlyBetterStop(
                              quantized.numericPrice,
                              currentSl,
                              quantized.tickSize,
                              isLong
                          )) {
                              continue;
                          }

                          if (!isStopTriggerAdmissible(
                              quantized.numericPrice,
                              markPrice,
                              quantized.tickSize,
                              isLong
                          )) {
                              console.warn(
                                  `[BTC BREAK CAP SKIP] ${trade.symbol}: mark ${markPrice} ` +
                                  `đã vượt cap ${quantized.formattedPrice}; giữ nguyên SL ${currentSl}.`
                              );
                              continue;
                          }

                          const exitSide = isLong ? 'SELL' : 'BUY';
                          try {
                              const mutationResult = await withSymbolOrderLock(
                                  trade.symbol,
                                  async () => {
                                      const freshOrders =
                                          await readSymbolOpenOrders(trade.symbol);
                                      if (!freshOrders) {
                                          throw new Error(
                                              'Không xác minh được order state trước replace.'
                                          );
                                      }

                                      const exactStopOrders = freshOrders.filter(order =>
                                          order.symbol === trade.symbol &&
                                          order.side === exitSide &&
                                          isStopLossOrder(order)
                                      );
                                      const replaceableStops =
                                          selectReplaceableStopOrders({
                                              orders: freshOrders,
                                              symbol: trade.symbol,
                                              exitSide,
                                              currentDbSl: currentSl,
                                              tickSize: quantized.tickSize,
                                              storedSlAlgoId: trade.sl_algo_id
                                          });

                                      const foreignStops = exactStopOrders.filter(
                                          order => !replaceableStops.includes(order)
                                      );
                                      if (foreignStops.length > 0) {
                                          return { skipped: 'foreign' };
                                      }

                                      const existingReplacement =
                                          replaceableStops.find(order =>
                                              isOwnedAlgoOrder(order) &&
                                              isSameTriggerPrice(
                                                  order,
                                                  quantized.numericPrice,
                                                  quantized.tickSize
                                              )
                                          );

                                      const replacement = await replaceStopSafely({
                                          existingStops: replaceableStops,
                                          existingReplacement,
                                          createAndVerify: async () => {
                                              const clientAlgoId =
                                                  makeClientAlgoId(trade.id);
                                              const newOrderPayload =
                                                  makePositionReductionPayload(
                                                      position,
                                                      {
                                                          symbol: trade.symbol,
                                                          side: exitSide,
                                                          type: 'STOP_MARKET',
                                                          triggerPrice:
                                                              quantized.formattedPrice,
                                                          quantity: Math.abs(
                                                              Number.parseFloat(
                                                                  position.positionAmt
                                                              )
                                                          ),
                                                          workingType: 'MARK_PRICE',
                                                          priceProtect: 'true',
                                                          algoType: 'CONDITIONAL',
                                                          clientAlgoId
                                                      }
                                                  );

                                              let createdData = null;
                                              let creationError = null;
                                              try {
                                                  const created =
                                                      await sendBinanceReq(
                                                          'POST',
                                                          '/fapi/v1/algoOrder',
                                                          newOrderPayload
                                                      );
                                                  createdData = created.data;
                                              } catch (error) {
                                                  // Timeout/5xx có thể xảy ra
                                                  // khi lệnh đã được nhận; xác
                                                  // minh bằng clientAlgoId
                                                  // trước khi kết luận thất bại.
                                                  creationError = error;
                                              }

                                              const verified =
                                                  await verifyAlgoOrder(
                                                      trade.symbol,
                                                      createdData,
                                                      clientAlgoId
                                                  );
                                              if (!verified && creationError) {
                                                  throw creationError;
                                              }
                                              return verified;
                                          },
                                          isSameOrder: (oldStop, replacement) =>
                                              replacement.algoId !== undefined &&
                                              String(oldStop.algoId) ===
                                                  String(replacement.algoId),
                                          cancelOld: async oldStop => {
                                              try {
                                                  await cancelExactOrder(
                                                      trade.symbol,
                                                      oldStop
                                                  );
                                              } catch (error) {
                                                  console.error(
                                                      `[BTC BREAK CAP DUPLICATE] Không xóa được SL cũ ${trade.symbol}:`,
                                                      error.response?.data?.msg ||
                                                      error.message
                                                  );
                                              }
                                          }
                                      });
                                      return {
                                          skipped: false,
                                          slAlgoId: replacement.algoId ?? null
                                      };
                                  }
                              );

                              if (mutationResult?.skipped) {
                                  if (mutationResult.skipped === 'foreign') {
                                      console.log(
                                          `[BTC BREAK CAP SKIP] ${trade.symbol}: SL ngoài engine; không hủy lệnh đặt tay.`
                                      );
                                  } else {
                                      console.log(
                                          `[BTC BREAK CAP LOCK] ${trade.symbol} đang có mutation khác; thử lại vòng sau.`
                                      );
                                  }
                                  continue;
                              }

                              const nextSlAlgoId =
                                  mutationResult?.slAlgoId ?? trade.sl_algo_id;
                              if (!mutationResult?.slAlgoId) {
                                  console.error(
                                      `[BTC BREAK CAP PERSIST] ${trade.symbol}: không xác minh được slAlgoId; giữ sl_algo_id cũ.`
                                  );
                              }
                              await persistTrailingState(trade.id, {
                                  sl: quantized.numericPrice,
                                  sl_algo_id: nextSlAlgoId
                              });
                              console.log(
                                  `[BTC BREAK CAP] ${trade.symbol}: ` +
                                  `${currentSl} -> ${quantized.formattedPrice} ` +
                                  `(${btcBreak.kind}, cap 1R)`
                              );
                          } catch (error) {
                              console.error(
                                  `❌ [BTC BREAK CAP] Không cap SL ${trade.symbol}:`,
                                  error.response?.data?.msg || error.message
                              );
                          }
                      }
                      btcBreakCooldown.recordTrigger();
                  }
              } catch (error) {
                  console.error(
                      '[BTC BREAK FAIL-CLOSED] Không đánh giá được break:',
                      error.response?.data?.msg || error.message
                  );
              }
          }

          const openTrades = [...queriedTrades].sort(
              (a, b) => new Date(b.created_at) - new Date(a.created_at)
          );
          const processedSymbols = new Set();
  
          for (const trade of openTrades) {
              if (portfolioClosedTradeIds.has(trade.id)) {
                  continue;
              }
              if (processedSymbols.has(trade.symbol)) {
                  console.error(
                      `[TRAILING FAIL-CLOSED] Có nhiều OPEN log cho ${trade.symbol}; chỉ xử lý log mới nhất.`
                  );
                  continue;
              }
              processedSymbols.add(trade.symbol);
  
              const position = findPositionForTrade(positionsRes, trade);
              if (!position) continue;
  
              const entryPrice = Number.parseFloat(trade.entry);
              const currentSl = Number.parseFloat(trade.sl);
              const cachedMark = markPriceCache.get(trade.symbol);
              const hasFreshStreamPrice =
                  cachedMark &&
                  Date.now() - cachedMark.updatedAt <= 5000;
              const markPrice = hasFreshStreamPrice
                  ? cachedMark.price
                  : Number.parseFloat(position.markPrice);
              const initialRiskPerCoin =
                  Number.parseFloat(trade.initial_risk_per_coin);
              const isLong = trade.direction === 'LONG';
              const persistedHighWater =
                  Number.parseFloat(trade.high_water_price);
              const observedHighWater = hasFreshStreamPrice
                  ? (
                      isLong
                          ? Math.max(
                              Number.isFinite(persistedHighWater)
                                  ? persistedHighWater
                                  : entryPrice,
                              cachedMark.high
                          )
                          : Math.min(
                              Number.isFinite(persistedHighWater)
                                  ? persistedHighWater
                                  : entryPrice,
                              cachedMark.low
                          )
                  )
                  : persistedHighWater;
  
              if (
                  !Number.isFinite(initialRiskPerCoin) ||
                  initialRiskPerCoin <= 0
              ) {
                  console.error(
                      `[TRAILING] ${trade.symbol} thiếu initial_risk_per_coin. Bỏ qua để an toàn.`
                  );
                  continue;
              }
  
              const openedAt = trade.opened_at || trade.created_at;
              const openTimeMs = new Date(openedAt).getTime();
              if (!Number.isFinite(openTimeMs)) {
                  console.error(
                      `[TEMPORAL] Invalid opened_at: ${trade.symbol}`,
                      openedAt
                  );
                  continue;
              }
  
              const intervalMs = INTERVAL_MS[trade.interval] || 3600000;
              const candlesPassed = (Date.now() - openTimeMs) / intervalMs;
              const rawMaxCycles =
                Number.parseInt(trade.planned_holding_cycles) ||
                Number.parseInt(trade.holding_cycles) ||
                5;
  
              // Soft extension: profitable trades at TRAIL or LOCK stage
              // get 25% more holding time to let winners run.
              const isProtected =
                trade.protection_stage === 'TRAIL' ||
                trade.protection_stage === 'LOCK';
              const highWaterR = Number.isFinite(initialRiskPerCoin) &&
                initialRiskPerCoin > 0
                ? (Math.abs(observedHighWater - entryPrice) / initialRiskPerCoin)
                : 0;
              const maxHoldingCycles =
                isProtected && highWaterR >= 1.5
                  ? Math.round(rawMaxCycles * 1.25)
                  : rawMaxCycles;
  
              if (candlesPassed >= maxHoldingCycles) {
                  console.log(`⏰ [TIME BARRIER] ${trade.symbol} đạt giới hạn ${maxHoldingCycles} nến (Extended: ${maxHoldingCycles > rawMaxCycles}). Tiến hành ép đóng.`);
                  const closeSide = isLong ? 'SELL' : 'BUY';
                  const closeQty = Math.abs(Number.parseFloat(position.positionAmt));
  
                  let closeAccepted = false;
                  try {
                      await persistTrailingState(trade.id, {
                          exit_reason: 'TEMPORAL_BARRIER_PENDING'
                      });
                      const closeResult = await withSymbolOrderLock(trade.symbol, async () => {
                          await sendBinanceReq(
                              'POST',
                              '/fapi/v1/order',
                              makePositionReductionPayload(position, {
                                  symbol: trade.symbol,
                                  side: closeSide,
                                  type: 'MARKET',
                                  quantity: closeQty,
                                  newClientOrderId: makeExitClientOrderId(
                                      'temporal',
                                      trade.id
                                  )
                              })
                          );
                          closeAccepted = true;
  
                          try {
                              const remainingOrders =
                                  await readSymbolOpenOrders(trade.symbol);
                              if (remainingOrders) {
                                  for (const order of remainingOrders) {
                                      if (
                                          isOwnedAlgoOrder(order) &&
                                          (
                                              isStopLossOrder(order) ||
                                              isTakeProfitOrder(order)
                                          )
                                      ) {
                                          await cancelExactOrder(
                                              trade.symbol,
                                              order
                                          );
                                      }
                                  }
                              }
                          } catch (cleanupError) {
                              console.error(
                                  `[TIME BARRIER CLEANUP] ${trade.symbol}:`,
                                  cleanupError.response?.data?.msg ||
                                  cleanupError.message
                              );
                          }
                      });
                      if (closeResult?.skipped) {
                          throw new Error('Symbol đang được mutation; chưa thể ép đóng.');
                      }
  
                      await persistTrailingState(trade.id, {
                          status: 'CLOSED',
                          close_price: markPrice,
                          exit_reason: 'TEMPORAL_BARRIER_HIT'
                      });
                      continue;
                  } catch (error) {
                      if (!closeAccepted) {
                          try {
                              await persistTrailingState(trade.id, {
                                  exit_reason: null
                              });
                          } catch (rollbackError) {
                              console.error(
                                  `[TIME BARRIER INTENT] ${trade.symbol}:`,
                                  rollbackError.message
                              );
                          }
                      }
                      console.error(
                          `❌ [TIME BARRIER] Lỗi khi ép đóng ${trade.symbol}:`,
                          error.response?.data?.msg || error.message
                      );
                  }
              }
  
              let decision;
              try {
                  const policyOverride = resolveOptimizedTrailingPolicy(
                      getCurrentAiModel(),
                      trade.strategy_name,
                      trade.asset_tier,
                      trade.regime_at_entry,
                      trade.btc_regime_at_entry
                  );
                  decision = calculateTrailingDecision({
                      entryPrice,
                      currentSl,
                      markPrice,
                      initialRiskPerCoin,
                      direction: trade.direction,
                      storedHighWater: observedHighWater,
                      protectionStage: trade.protection_stage,
                      strategyName: trade.strategy_name,
                      assetTier: trade.asset_tier,
                      policyOverride
                  });
              } catch (error) {
                  console.error(`[TRAILING] Input không hợp lệ ${trade.symbol}:`, error.message);
                  continue;
              }
  
              const highWaterChanged =
                  decision.highWaterPrice !== persistedHighWater;
              const stageAdvanced =
                  PROTECTION_STAGE_RANK[decision.nextStage] >
                  PROTECTION_STAGE_RANK[decision.currentStage];
  
              if (decision.nextStage === 'NONE') {
                  if (highWaterChanged) {
                      try {
                          await persistTrailingState(trade.id, {
                              high_water_price: decision.highWaterPrice,
                              high_water_r: decision.highWaterR
                          });
                      } catch (error) {
                          console.error(`[TRAILING DB] ${trade.symbol}:`, error.message);
                      }
                  }
                  continue;
              }
  
              const priceFilter = exchangePriceFilters.get(trade.symbol);
              if (!priceFilter) {
                  console.error(
                      `[TRAILING FAIL-CLOSED] Thiếu PRICE_FILTER cho ${trade.symbol}.`
                  );
                  continue;
              }
  
              let quantized;
              try {
                  quantized = quantizeStopPrice(
                      decision.targetSl,
                      priceFilter,
                      isLong
                  );
              } catch (error) {
                  console.error(`[TRAILING TICK] ${trade.symbol}:`, error.message);
                  continue;
              }
  
              const shouldMoveStop = isStrictlyBetterStop(
                  quantized.numericPrice,
                  currentSl,
                  quantized.tickSize,
                  isLong
              );
  
              if (!shouldMoveStop) {
                  if (highWaterChanged) {
                      try {
                          await persistTrailingState(trade.id, {
                              high_water_price: decision.highWaterPrice,
                              high_water_r: decision.highWaterR
                          });
                      } catch (error) {
                          console.error(`[TRAILING DB] ${trade.symbol}:`, error.message);
                      }
                  }
                  continue;
              }

              if (!isStopTriggerAdmissible(
                  quantized.numericPrice,
                  markPrice,
                  quantized.tickSize,
                  isLong
              )) {
                  const lastLoggedAt = crossedTargetLoggedAt.get(trade.symbol) || 0;
                  if (Date.now() - lastLoggedAt >= 60_000) {
                      crossedTargetLoggedAt.set(trade.symbol, Date.now());
                      console.warn(
                          `[TRAILING SKIP] ${trade.symbol}: target ${quantized.formattedPrice} ` +
                          `đã bị Mark Price ${markPrice} vượt qua; giữ nguyên SL ${currentSl}.`
                      );
                  }
                  if (highWaterChanged) {
                      try {
                          await persistTrailingState(trade.id, {
                              high_water_price: decision.highWaterPrice,
                              high_water_r: decision.highWaterR
                          });
                      } catch (error) {
                          console.error(`[TRAILING DB] ${trade.symbol}:`, error.message);
                      }
                  }
                  continue;
              }
  
              const exitSide = isLong ? 'SELL' : 'BUY';
              console.log(
                  `[🛡️ TRAILING] ${decision.triggerReason} ${trade.symbol}: ` +
                  `${currentSl} -> ${quantized.formattedPrice}`
              );
  
              try {
                  const mutationResult = await withSymbolOrderLock(
                      trade.symbol,
                      async () => {
                          const freshOrders = await readSymbolOpenOrders(trade.symbol);
                          if (!freshOrders) {
                              throw new Error('Không xác minh được order state trước replace.');
                          }
  
                          const exactStopOrders = freshOrders.filter(order =>
                              order.symbol === trade.symbol &&
                              order.side === exitSide &&
                              isStopLossOrder(order)
                          );
                          const replaceableStops = selectReplaceableStopOrders({
                              orders: freshOrders,
                              symbol: trade.symbol,
                              exitSide,
                              currentDbSl: currentSl,
                              tickSize: quantized.tickSize,
                              storedSlAlgoId: trade.sl_algo_id
                          });
  
                          const foreignStops = exactStopOrders.filter(
                              order => !replaceableStops.includes(order)
                          );
                          if (foreignStops.length > 0) {
                              throw new Error(
                                  'Phát hiện SL không thuộc engine; bỏ qua để không hủy lệnh đặt tay.'
                              );
                          }
  
                          const existingReplacement = replaceableStops.find(order =>
                              isOwnedAlgoOrder(order) &&
                              isSameTriggerPrice(
                                  order,
                                  quantized.numericPrice,
                                  quantized.tickSize
                              )
                          );
  
                          const replacement = await replaceStopSafely({
                              existingStops: replaceableStops,
                              existingReplacement,
                              createAndVerify: async () => {
                                  const clientAlgoId = makeClientAlgoId(trade.id);
                                  const newOrderPayload = makePositionReductionPayload(
                                      position,
                                      {
                                          symbol: trade.symbol,
                                          side: exitSide,
                                          type: 'STOP_MARKET',
                                          triggerPrice: quantized.formattedPrice,
                                          quantity: Math.abs(
                                              Number.parseFloat(position.positionAmt)
                                          ),
                                          workingType: 'MARK_PRICE',
                                          priceProtect: 'true',
                                          algoType: 'CONDITIONAL',
                                          clientAlgoId
                                      }
                                  );
  
                                  let createdData = null;
                                  let creationError = null;
                                  try {
                                      const created = await sendBinanceReq(
                                          'POST',
                                          '/fapi/v1/algoOrder',
                                          newOrderPayload
                                      );
                                      createdData = created.data;
                                  } catch (error) {
                                      // Binance có thể trả timeout/5xx trong khi
                                      // lệnh đã được nhận. Xác minh bằng
                                      // clientAlgoId trước khi kết luận thất bại.
                                      creationError = error;
                                  }
  
                                  const verified = await verifyAlgoOrder(
                                      trade.symbol,
                                      createdData,
                                      clientAlgoId
                                  );
                                  if (!verified && creationError) {
                                      throw creationError;
                                  }
                                  return verified;
                              },
                              isSameOrder: (oldStop, replacement) =>
                                  replacement.algoId !== undefined &&
                                  String(oldStop.algoId) ===
                                      String(replacement.algoId),
                              cancelOld: async oldStop => {
                                  try {
                                      await cancelExactOrder(
                                          trade.symbol,
                                          oldStop
                                      );
                                  } catch (error) {
                                      console.error(
                                          `[TRAILING DUPLICATE] Không xóa được SL cũ ${trade.symbol}:`,
                                          error.response?.data?.msg ||
                                          error.message
                                      );
                                  }
                              }
                          });
                          return {
                              skipped: false,
                              slAlgoId: replacement.algoId ?? null
                          };
                      }
                  );
  
                  if (mutationResult?.skipped) {
                      console.log(
                          `[TRAILING LOCK] ${trade.symbol} đang có mutation khác; thử lại vòng sau.`
                      );
                      continue;
                  }
  
                  await persistTrailingState(trade.id, {
                      sl: quantized.numericPrice,
                      sl_algo_id: mutationResult?.slAlgoId ?? trade.sl_algo_id,
                      protection_stage: decision.nextStage,
                      high_water_price: decision.highWaterPrice,
                      high_water_r: decision.highWaterR,
                      trailing_activated: true
                  });
                  console.log(`✅ [🛡️ TRAILING] Đã xác minh SL mới ${trade.symbol}.`);
              } catch (error) {
                  console.error(
                      `❌ [TRAILING] Không dời SL ${trade.symbol}:`,
                      error.response?.data?.msg || error.message
                  );
  
                  if (highWaterChanged || stageAdvanced) {
                      try {
                          await persistTrailingState(trade.id, {
                              high_water_price: decision.highWaterPrice,
                              high_water_r: decision.highWaterR
                          });
                      } catch (dbError) {
                          console.error(`[TRAILING DB] ${trade.symbol}:`, dbError.message);
                      }
                  }
              }
          }
      } catch (error) {
          console.error(
              '[TRAILING ENGINE ERROR]',
              error?.response?.data ||
              error?.stack ||
              error?.message ||
              error
          );
      }
  }
  // =====================================================================
  // 🔍 ĐỘNG CƠ ĐÁNH GIÁ HẬU GIAO DỊCH (POST-EXIT EXCURSION - PEE)
  // Mục tiêu: Bắt lỗi "Chốt Non" (Alpha Decay) và "Bị Quét SL" (Shakeout)
  // =====================================================================

  return {
    cancelExactOrder,
    runSmartTrailingEngine,
    withSymbolOrderLock
  };
}

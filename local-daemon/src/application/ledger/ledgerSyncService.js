import { findPositionForTrade } from '../../domain/orders/trailingOrders.js';
import {
  isPendingOrderExpired,
  evaluatePendingOrderGateInvalidation
} from '../../../../src/domain/trading/pendingOrderPolicy.js';
import QuantMath from '../../../../src/domain/analytics/QuantMath.js';
import {
  cancelTradeAlgoOrders as cancelOwnedTradeAlgoOrders
} from '../trading/orderOwnershipService.js';

const INTERVAL_MS = {
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000
};

function asFiniteNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function attributeTradeFills(log, trades = []) {
  const createdTs = new Date(log.created_at || log.opened_at).getTime();
  const openedTs = new Date(log.opened_at || log.created_at).getTime();
  const entrySide = log.direction === 'LONG' ? 'BUY' : 'SELL';
  const exitSide = log.direction === 'LONG' ? 'SELL' : 'BUY';
  const searchStart = Number.isFinite(createdTs) ? createdTs - 60_000 : 0;
  const searchEnd = Number.isFinite(openedTs)
    ? openedTs + 60_000
    : Date.now();

  const entryCandidates = trades
    .filter(trade => {
      const time = Number(trade.time);
      return (
        String(trade.side || '').toUpperCase() === entrySide &&
        Math.abs(asFiniteNumber(trade.realizedPnl)) < 1e-12 &&
        Number.isFinite(time) &&
        time >= searchStart &&
        time <= searchEnd
      );
    })
    .sort((left, right) => {
      const reference = Number.isFinite(createdTs) ? createdTs : openedTs;
      return (
        Math.abs(Number(left.time) - reference) -
        Math.abs(Number(right.time) - reference)
      );
    });

  const anchorEntry = entryCandidates[0];
  let entryTrades = [];
  if (anchorEntry) {
    if (anchorEntry.orderId !== undefined && anchorEntry.orderId !== null) {
      entryTrades = entryCandidates.filter(
        trade => String(trade.orderId) === String(anchorEntry.orderId)
      );
    } else {
      entryTrades = entryCandidates.filter(
        trade => Math.abs(Number(trade.time) - Number(anchorEntry.time)) <= 5_000
      );
    }
  }

  const entryBoundary = entryTrades.length > 0
    ? Math.min(...entryTrades.map(trade => Number(trade.time)))
    : (Number.isFinite(createdTs) ? Math.floor(createdTs / 1000) * 1000 : 0);
  const exitTrades = trades
    .filter(trade => {
      const side = String(trade.side || '').toUpperCase();
      const hasRealizedPnl = Math.abs(asFiniteNumber(trade.realizedPnl)) > 1e-12;
      const isExitSide = side === exitSide || (!side && hasRealizedPnl);
      return (
        isExitSide &&
        Number.isFinite(Number(trade.time)) &&
        Number(trade.time) >= entryBoundary
      );
    })
    .sort((left, right) => Number(left.time) - Number(right.time));

  return { entryBoundary, entryTrades, exitTrades };
}

export function calculateNetTradePnl({
  entryBoundary,
  entryTrades,
  exitTrades,
  incomeRecords
}) {
  const grossPnl = exitTrades.reduce(
    (sum, trade) => sum + asFiniteNumber(trade.realizedPnl),
    0
  );
  if (!Array.isArray(incomeRecords)) {
    return { grossPnl, netPnl: grossPnl, commission: 0, funding: 0 };
  }

  const closeTs = exitTrades.length > 0
    ? Number(exitTrades.at(-1).time)
    : entryBoundary;
  const selectedTradeIds = new Set(
    [...entryTrades, ...exitTrades]
      .map(trade => trade.id)
      .filter(id => id !== undefined && id !== null)
      .map(String)
  );
  let commission = 0;
  let funding = 0;

  for (const record of incomeRecords) {
    const type = String(record.incomeType || '').toUpperCase();
    const time = Number(record.time);
    if (type === 'COMMISSION' && selectedTradeIds.has(String(record.tradeId))) {
      commission += asFiniteNumber(record.income);
    } else if (
      type === 'FUNDING_FEE' &&
      Number.isFinite(time) &&
      time >= entryBoundary &&
      time <= closeTs
    ) {
      funding += asFiniteNumber(record.income);
    }
  }

  return {
    grossPnl,
    netPnl: grossPnl + commission + funding,
    commission,
    funding
  };
}

export function resolveExitReason(log, exitTrade, algoStates = {}, algoCleanup = {}) {
  const storedReason = String(log.exit_reason || '').trim();
  if (storedReason && storedReason !== 'MANUAL_CLOSE') {
    if (storedReason === 'PANIC_SELL_REVERSAL_PENDING') {
      return 'PANIC_SELL_REVERSAL';
    }
    if (storedReason === 'TEMPORAL_BARRIER_PENDING') {
      return 'TEMPORAL_BARRIER_HIT';
    }
    return storedReason;
  }

  const exitClientOrderId = String(
    exitTrade?.clientOrderId ||
    exitTrade?.origClientOrderId ||
    ''
  );
  if (exitClientOrderId.startsWith('qts-ex-panic-')) {
    return 'PANIC_SELL_REVERSAL';
  }
  if (exitClientOrderId.startsWith('qts-ex-time-')) {
    return 'TEMPORAL_BARRIER_HIT';
  }

  const exitOrderId = exitTrade?.orderId;
  const matchesTriggeredAlgo = state => {
    const status = String(state?.algoStatus || '').toUpperCase();
    const isTriggeredStatus = ['TRIGGERED', 'FINISHED', 'FILLED', 'EXECUTED'].includes(status);
    if (!isTriggeredStatus) return false;
    if (
      exitOrderId !== undefined &&
      exitOrderId !== null &&
      state?.actualOrderId !== undefined &&
      state?.actualOrderId !== null &&
      String(state.actualOrderId) !== ''
    ) {
      return String(state.actualOrderId) === String(exitOrderId);
    }
    return true;
  };

  const slFailed2011 = Array.isArray(algoCleanup?.failed) &&
    algoCleanup.failed.some(f => f.kind === 'sl' && String(f.code) === '-2011');
  const tpFailed2011 = Array.isArray(algoCleanup?.failed) &&
    algoCleanup.failed.some(f => f.kind === 'tp' && String(f.code) === '-2011');

  const isTpAlgoTriggered = matchesTriggeredAlgo(algoStates.tp) || tpFailed2011;
  const isSlAlgoTriggered = matchesTriggeredAlgo(algoStates.sl) || slFailed2011;

  if (isTpAlgoTriggered && !isSlAlgoTriggered) return 'TAKE_PROFIT_HIT';
  if (isSlAlgoTriggered && !isTpAlgoTriggered) {
    return log.trailing_activated === true ||
      String(log.protection_stage || 'NONE').toUpperCase() !== 'NONE'
      ? 'TRAILING_STOP_HIT'
      : 'STOP_LOSS_HIT';
  }

  if (matchesTriggeredAlgo(algoStates.tp)) return 'TAKE_PROFIT_HIT';
  if (matchesTriggeredAlgo(algoStates.sl)) {
    return log.trailing_activated === true ||
      String(log.protection_stage || 'NONE').toUpperCase() !== 'NONE'
      ? 'TRAILING_STOP_HIT'
      : 'STOP_LOSS_HIT';
  }

  return 'UNCLASSIFIED_EXCHANGE_CLOSE';
}

export function createLedgerSyncService(context = {}) {
  const {
    markPriceCache,
    readBinanceReq,
    sendBinanceReq,
    supabase,
    getMarketSnapshot,
    marketDataCache
  } = context;

  // Xóa đúng CO (SL/TP algo orders) của một lệnh cụ thể bằng algoId đã lưu trong DB.
  // An toàn: KHÔNG ảnh hưởng các CO của lệnh khác đang chạy cùng coin.
  async function cancelTradeAlgoOrders(log) {
    const result = await cancelOwnedTradeAlgoOrders({
      log,
      sendBinanceReq
    });
    for (const cancelled of result.cancelled) {
      const reference = cancelled.algoId ?? cancelled.clientAlgoId;
      console.log(
        `[ALGO CANCEL] ${log.symbol} ${cancelled.kind.toUpperCase()}=${reference}`
      );
    }
    for (const failed of result.failed) {
      const reference = failed.algoId ?? failed.clientAlgoId;
      const isAlreadyClosed = String(failed.code) === '-2011';
      if (isAlreadyClosed) {
        console.log(
          `[ALGO CANCEL INFO] ${log.symbol} ${failed.kind.toUpperCase()}=${reference} ` +
          `đã khớp/đóng trước đó (code=-2011)`
        );
      } else {
        console.warn(
          `[ALGO CANCEL FAIL] ${log.symbol} ${failed.kind.toUpperCase()}=${reference} ` +
          `code=${failed.code}: ${failed.message}`
        );
      }
    }
    return result;
  }

  async function readTradeAlgoStates(log) {
    const states = {};
    for (const [kind, algoId] of [
      ['sl', log.sl_algo_id],
      ['tp', log.tp_algo_id]
    ]) {
      if (algoId === undefined || algoId === null || algoId === '') continue;
      try {
        states[kind] = await readBinanceReq('/fapi/v1/algoOrder', {
          symbol: log.symbol,
          algoId
        });
      } catch (error) {
        console.warn(
          `[ALGO STATE UNKNOWN] ${log.symbol} ${kind.toUpperCase()}=${algoId}:`,
          error.message
        );
      }
    }
    return states;
  }

  // Hủy các lệnh Limit/Market chưa khớp thông thường (không liên quan đến algo/CO orders).
  async function safeCancelLimitOrders(symbol) {
    if (typeof sendBinanceReq !== 'function') return;
    try {
      await sendBinanceReq('DELETE', '/fapi/v1/allOpenOrders', { symbol });
    } catch (error) {
      console.warn(
        `[LEDGER LIMIT CLEANUP] ${symbol}:`,
        error.message
      );
    }
  }

  async function runLedgerStateSync() {
    try {
      const { data: activeLogs, error: activeLogsError } = await supabase
        .from('trade_logs')
        .select(`
          id,
          symbol,
          direction,
          status,
          entry,
          sl,
          tp_1_price,
          position_size_usd,
          created_at,
          initial_sl,
          initial_risk_per_coin,
          opened_at,
          protection_stage,
          trailing_activated,
          high_water_price,
          high_water_r,
          interval,
          strategy_name,
          soft_score,
          exit_reason,
          close_price,
          sl_algo_id,
          tp_algo_id
        `)
        .in('status', ['PENDING', 'OPEN', 'CLOSED'])
        .eq('type', 'FUTURES')
        .order('created_at', { ascending: false });

      if (activeLogsError) {
        console.error('[LEDGER SYNC] Supabase query lỗi:', activeLogsError.message);
        return;
      }

      const positionsRes = await readBinanceReq('/fapi/v2/positionRisk');
      if (!positionsRes || !Array.isArray(positionsRes)) return;

      const processedSymbols = new Set();

      for (const log of activeLogs) {
        const position = findPositionForTrade(positionsRes, log);
        const posAmt = position ? parseFloat(position.positionAmt) : 0;
        const isLongPos = posAmt > 0;
        const isShortPos = posAmt < 0;

        // KỊCH BẢN 1: LỆNH CHỜ VỪA KHỚP (PENDING -> OPEN)
        if (log.status === 'PENDING') {
          if ((log.direction === 'LONG' && isLongPos) || (log.direction === 'SHORT' && isShortPos)) {
            if (!processedSymbols.has(log.symbol)) {
              console.log(`[🔄 LEDGER SYNC] Lệnh ${log.symbol} đã khớp trên sàn. Kích hoạt trạng thái OPEN!`);
              const actualEntry = parseFloat(position.entryPrice);
              const initialSl = parseFloat(log.initial_sl ?? log.sl);
              const initialRiskPerCoin = Math.abs(actualEntry - initialSl);

              if (
                !Number.isFinite(actualEntry) ||
                !Number.isFinite(initialSl) ||
                !Number.isFinite(initialRiskPerCoin) ||
                initialRiskPerCoin <= 0
              ) {
                console.error(`[RISK INIT] Không thể khởi tạo R cho ${log.symbol}`, {
                  actualEntry,
                  initialSl,
                  initialRiskPerCoin
                });
                continue;
              }

              const { error: openUpdateError } = await supabase
                .from('trade_logs')
                .update({
                  status: 'OPEN',
                  entry: actualEntry,
                  initial_sl: initialSl,
                  initial_risk_per_coin: initialRiskPerCoin,
                  opened_at: new Date().toISOString(),
                  protection_stage: 'NONE',
                  high_water_price: actualEntry,
                  high_water_r: 0
                })
                .eq('id', log.id);

              if (openUpdateError) {
                console.error(`[LEDGER OPEN ERROR] ${log.symbol}:`, openUpdateError.message);
                continue;
              }

              const latestMark = markPriceCache.get(log.symbol)?.price;
              const baselineMark = Number.isFinite(latestMark) ? latestMark : actualEntry;
              markPriceCache.set(log.symbol, {
                price: baselineMark,
                high: Math.max(actualEntry, baselineMark),
                low: Math.min(actualEntry, baselineMark),
                updatedAt: Date.now()
              });

              console.log(
                `[✅ RISK INIT] ${log.symbol} | ` +
                `Entry=${actualEntry} | ` +
                `Initial SL=${initialSl} | ` +
                `1R=${initialRiskPerCoin}`
              );

              processedSymbols.add(log.symbol);
            } else {
              console.log(`[🧹 DB CLEANUP] Xóa bản ghi PENDING bị duplicate của ${log.symbol}.`);
              await supabase.from('trade_logs').update({
                status: 'CANCELED',
                exit_reason: 'DUPLICATE_ENTRY_FIXED'
              }).eq('id', log.id);
            }
          } else {
            const cleanStratName = String(log.strategy_name || log.strategy || '').replace(/\s*\[(BOT|SCALP)\]/gi, '').trim();
            const orderForPolicy = {
              ...log,
              timeframe: log.interval || log.timeframe,
              strategy: cleanStratName,
              strategyId: cleanStratName,
              initialScore: log.soft_score !== undefined && log.soft_score !== null ? parseFloat(log.soft_score) : log.initialScore,
              initialAtr: log.atr_at_entry !== undefined && log.atr_at_entry !== null ? parseFloat(log.atr_at_entry) : log.initialAtr
            };

            // a. Check time-based expiry (3 candles)
            if (isPendingOrderExpired(orderForPolicy, Date.now(), 3)) {
              console.log(`[\u23f0 PENDING EXPIRED] Lệnh PENDING ${log.symbol} (${log.interval}) đã hết hạn 3 nến. Hủy lệnh...`);
              await cancelTradeAlgoOrders(log);
              await safeCancelLimitOrders(log.symbol);
              await supabase
                .from('trade_logs')
                .update({
                  status: 'CANCELLED_EXPIRED',
                  exit_reason: 'EXPIRED_3_CANDLES',
                  close_time: new Date().toISOString()
                })
                .eq('id', log.id)
                .catch(() => {});
            } else {
              // b. Check gate invalidation
              let snapshot = null;
              if (typeof getMarketSnapshot === 'function') {
                snapshot = await getMarketSnapshot(log.symbol, log.interval);
              } else if (marketDataCache) {
                if (typeof marketDataCache.getSnapshot === 'function') {
                  snapshot = await marketDataCache.getSnapshot(log.symbol, log.interval);
                } else if (typeof marketDataCache.getKlines === 'function') {
                  const interval = log.interval || '15m';
                  const klines = await marketDataCache.getKlines(log.symbol, interval);
                  if (Array.isArray(klines) && klines.length > 0) {
                    const closes = klines.map(k => parseFloat(k[4]));
                    const highs = klines.map(k => parseFloat(k[2]));
                    const lows = klines.map(k => parseFloat(k[3]));
                    const volumes = klines.map(k => parseFloat(k[5]));

                    const ema20 = QuantMath.ema(closes, 20) || closes[closes.length - 1];
                    const atr14 = QuantMath.atr(highs, lows, closes, 14) || (log.atr_at_entry ? parseFloat(log.atr_at_entry) : 0);
                    const cmf = QuantMath.cmf ? QuantMath.cmf(highs, lows, closes, volumes, 20) : 0;
                    const msbRes = QuantMath.detectMarketStructure ? QuantMath.detectMarketStructure(highs, lows, closes) : { msbState: 'None' };
                    const msbState = typeof msbRes === 'string' ? msbRes : (msbRes?.msbState || 'None');

                    const bookTicker = typeof marketDataCache.getBookTicker === 'function' ? marketDataCache.getBookTicker(log.symbol) : null;
                    let realSpreadPct = 0;
                    if (bookTicker?.bidPrice && bookTicker?.askPrice) {
                      const bid = parseFloat(bookTicker.bidPrice);
                      const ask = parseFloat(bookTicker.askPrice);
                      if (bid > 0 && ask > 0) {
                        realSpreadPct = ((ask - bid) / ask) * 100;
                      }
                    }

                    snapshot = {
                      autoData: {
                        msbState,
                        vpinValue: 0.05,
                        l1: 'Trend',
                        ema20,
                        atr14,
                        cmf
                      },
                      apiMacro: {
                        realSpreadPct
                      },
                      softScore: log.soft_score !== undefined && log.soft_score !== null ? parseFloat(log.soft_score) : 80
                    };
                  }
                }
              }

              if (snapshot) {
                const invalidationResult = evaluatePendingOrderGateInvalidation(orderForPolicy, snapshot);
                if (invalidationResult?.isInvalidated) {
                  const reason = Array.isArray(invalidationResult.reasons)
                    ? invalidationResult.reasons.join('; ')
                    : String(invalidationResult.reasons || 'GATE_INVALIDATED');

                  console.log(`[🚫 PENDING INVALIDATED] Lệnh PENDING ${log.symbol} bị vi phạm gate: ${reason}. Hủy lệnh...`);
                  await cancelTradeAlgoOrders(log);
                  await safeCancelLimitOrders(log.symbol);
                  await supabase
                    .from('trade_logs')
                    .update({
                      status: 'CANCELLED_INVALIDATED',
                      exit_reason: reason,
                      close_time: new Date().toISOString()
                    })
                    .eq('id', log.id)
                    .catch(() => {});
                }
              } else {
                console.log(`[⏳ PENDING SYNC] Bỏ qua kiểm tra gate cho ${log.symbol} do market snapshot chưa sẵn sàng.`);
              }
            }
          }
        }
        // KỊCH BẢN 2 & 3: LỆNH ĐANG CHẠY HOẶC ĐÃ ĐÓNG (OPEN -> CLOSED -> WIN/LOSS)
        else if (log.status === 'OPEN' || log.status === 'CLOSED') {
          processedSymbols.add(log.symbol);

          // MIGRATION: BACKFILL INITIAL R CHO CÁC TRADE OPEN TỪ CODE CŨ
          let storedInitialRisk = parseFloat(log.initial_risk_per_coin);
          const hasValidInitialRisk = Number.isFinite(storedInitialRisk) && storedInitialRisk > 0;

          if (!hasValidInitialRisk && position && posAmt !== 0) {
            const actualEntry = parseFloat(position.entryPrice || log.entry);
            let sourceInitialSl = parseFloat(log.initial_sl);
            const hasValidInitialSl = Number.isFinite(sourceInitialSl) && sourceInitialSl > 0;

            const protectionStage = String(log.protection_stage || 'NONE').toUpperCase();
            const neverMovedStop = protectionStage === 'NONE' && log.trailing_activated !== true;

            if (!hasValidInitialSl && neverMovedStop) {
              sourceInitialSl = parseFloat(log.sl);
            }

            const canRecoverRisk =
              Number.isFinite(actualEntry) &&
              actualEntry > 0 &&
              Number.isFinite(sourceInitialSl) &&
              sourceInitialSl > 0 &&
              Math.abs(actualEntry - sourceInitialSl) > 0;

            if (canRecoverRisk) {
              const recoveredRisk = Math.abs(actualEntry - sourceInitialSl);
              const migrationUpdate = {
                entry: actualEntry,
                initial_sl: sourceInitialSl,
                initial_risk_per_coin: recoveredRisk,
                protection_stage: log.protection_stage || 'NONE',
                high_water_price: Number.isFinite(parseFloat(log.high_water_price))
                  ? parseFloat(log.high_water_price)
                  : actualEntry,
                high_water_r: Number.isFinite(parseFloat(log.high_water_r))
                  ? parseFloat(log.high_water_r)
                  : 0
              };

              const { error: migrationError } = await supabase
                .from('trade_logs')
                .update(migrationUpdate)
                .eq('id', log.id);

              if (migrationError) {
                console.error(`[RISK MIGRATION] ${log.symbol} thất bại:`, migrationError.message);
              } else {
                const latestMark = markPriceCache.get(log.symbol)?.price;
                const baselineMark = Number.isFinite(latestMark) ? latestMark : actualEntry;
                markPriceCache.set(log.symbol, {
                  price: baselineMark,
                  high: Math.max(actualEntry, baselineMark),
                  low: Math.min(actualEntry, baselineMark),
                  updatedAt: Date.now()
                });

                console.log(
                  `[✅ RISK MIGRATION] ${log.symbol} | ` +
                  `Initial SL=${sourceInitialSl} | ` +
                  `1R=${recoveredRisk}`
                );
              }
            } else {
              console.error(
                `[⚠️ RISK MIGRATION] ${log.symbol} không thể khôi phục initial R an toàn.`
              );
            }
          }

          // LOGIC XỬ LÝ VỊ THẾ KẾT THÚC -> RESOLVE WIN/LOSS
          if (
            posAmt === 0 ||
            log.status === 'CLOSED' ||
            (log.direction === 'LONG' && isShortPos) ||
            (log.direction === 'SHORT' && isLongPos)
          ) {
            console.log(`[🔄 LEDGER SYNC] Vị thế ${log.symbol} đã kết thúc. Đang xóa đúng CO của lệnh này và phân giải WIN/LOSS...`);
            const algoStates = await readTradeAlgoStates(log);
            const algoCleanup = await cancelTradeAlgoOrders(log);
            await safeCancelLimitOrders(log.symbol);

            try {
              let closeTs = Date.now();
              let totalPnl = 0;
              let grossPnl = 0;
              let commission = 0;
              let funding = 0;
              let hasTradeData = false;
              let entryBoundary = new Date(
                log.created_at || log.opened_at
              ).getTime();
              let entryTrades = [];
              let exitTrades = [];

              const tradesRes = await readBinanceReq('/fapi/v1/userTrades', {
                symbol: log.symbol,
                startTime: Math.max(0, entryBoundary - 60_000),
                limit: 1000
              });

              if (tradesRes && Array.isArray(tradesRes) && tradesRes.length > 0) {
                const attributed = attributeTradeFills(log, tradesRes);
                entryBoundary = attributed.entryBoundary;
                entryTrades = attributed.entryTrades;
                exitTrades = attributed.exitTrades;
                hasTradeData = exitTrades.length > 0;
              }

              if (!hasTradeData) {
                try {
                  const recentTradesRes = await readBinanceReq('/fapi/v1/userTrades', {
                    symbol: log.symbol,
                    startTime: Math.max(0, Date.now() - 24 * 60 * 60 * 1000),
                    limit: 1000
                  });
                  if (recentTradesRes && Array.isArray(recentTradesRes) && recentTradesRes.length > 0) {
                    const attributedRecent = attributeTradeFills(log, recentTradesRes);
                    if (attributedRecent.exitTrades.length > 0) {
                      exitTrades = attributedRecent.exitTrades;
                      if (attributedRecent.entryTrades.length > 0) {
                        entryTrades = attributedRecent.entryTrades;
                        entryBoundary = attributedRecent.entryBoundary;
                      }
                      hasTradeData = true;
                    }
                  }
                } catch (recentErr) {
                  // Fallback query error ignore
                }
              }

              const lastExitTrade = exitTrades.at(-1);
              let resolvedExitTrade = lastExitTrade;
              if (lastExitTrade) {
                closeTs = Number(lastExitTrade.time);
                if (
                  lastExitTrade.orderId !== undefined &&
                  lastExitTrade.orderId !== null
                ) {
                  try {
                    const exitOrder = await readBinanceReq(
                      '/fapi/v1/order',
                      {
                        symbol: log.symbol,
                        orderId: lastExitTrade.orderId
                      }
                    );
                    resolvedExitTrade = {
                      ...lastExitTrade,
                      ...exitOrder
                    };
                  } catch (orderError) {
                    console.warn(
                      `[EXIT ORDER UNKNOWN] ${log.symbol} orderId=${lastExitTrade.orderId}:`,
                      orderError.message
                    );
                  }
                }
              }
              const exitQuantity = exitTrades.reduce(
                (sum, trade) => sum + asFiniteNumber(trade.qty),
                0
              );
              const weightedExitNotional = exitTrades.reduce(
                (sum, trade) =>
                  sum +
                  asFiniteNumber(trade.price) *
                  asFiniteNumber(trade.qty),
                0
              );

              const exitReason = resolveExitReason(
                log,
                resolvedExitTrade,
                algoStates,
                algoCleanup
              );

              const fallbackExitPrice =
                (exitReason === 'STOP_LOSS_HIT' || exitReason === 'TRAILING_STOP_HIT') && Number.isFinite(parseFloat(log.sl)) && parseFloat(log.sl) > 0
                  ? parseFloat(log.sl)
                  : (exitReason === 'TAKE_PROFIT_HIT') && Number.isFinite(parseFloat(log.tp_1_price)) && parseFloat(log.tp_1_price) > 0
                    ? parseFloat(log.tp_1_price)
                    : asFiniteNumber(position?.markPrice || log.close_price || log.entry);

              const closePrice = exitQuantity > 0
                ? weightedExitNotional / exitQuantity
                : fallbackExitPrice;

              if (hasTradeData) {
                let incomeRecords = null;
                try {
                  incomeRecords = await readBinanceReq('/fapi/v1/income', {
                    symbol: log.symbol,
                    startTime: Math.max(
                      0,
                      Math.floor(entryBoundary / 1000) * 1000
                    ),
                    endTime: closeTs,
                    limit: 1000
                  });
                } catch (incomeError) {
                  console.error(
                    `[LEDGER PNL PARTIAL] ${log.symbol} không đọc được commission/funding:`,
                    incomeError.message
                  );
                }
                const pnl = calculateNetTradePnl({
                  entryBoundary,
                  entryTrades,
                  exitTrades,
                  incomeRecords
                });
                grossPnl = pnl.grossPnl;
                totalPnl = pnl.netPnl;
                commission = pnl.commission;
                funding = pnl.funding;
              }

              if (!hasTradeData) {
                const entryPrice = parseFloat(log.entry || 0);
                const posSizeUsd = parseFloat(log.position_size_usd || 100);
                if (entryPrice > 0) {
                  const pnlDiff = log.direction === 'LONG' ? (closePrice - entryPrice) : (entryPrice - closePrice);
                  totalPnl = (pnlDiff / entryPrice) * posSizeUsd;
                }
              }

              let holdingCycles = 1;
              if (log.opened_at) {
                const heldMs = closeTs - new Date(log.opened_at).getTime();
                const intervalMs = INTERVAL_MS[log.interval] || 900_000;
                holdingCycles = Math.max(1, Math.round(heldMs / intervalMs));
              }

              const finalPnl = totalPnl;
              let finalStatus = 'LOSS';
              if (finalPnl > 0) {
                finalStatus = 'WIN';
              } else if (finalPnl < 0) {
                finalStatus = 'LOSS';
              } else {
                finalStatus = exitReason === 'TAKE_PROFIT_HIT' ? 'WIN' : 'LOSS';
              }

              const entryPrice = parseFloat(log.entry);
              const positionSizeUsd = parseFloat(log.position_size_usd);
              const sizeCoins =
                Number.isFinite(entryPrice) &&
                entryPrice > 0 &&
                Number.isFinite(positionSizeUsd) &&
                positionSizeUsd > 0
                  ? positionSizeUsd / entryPrice
                  : null;
              const excursion = markPriceCache.get(log.symbol);
              let maxFavorableExcursionUsd = null;
              let maxAdverseExcursionUsd = null;
              if (
                sizeCoins !== null &&
                Number.isFinite(excursion?.high) &&
                Number.isFinite(excursion?.low)
              ) {
                if (log.direction === 'LONG') {
                  maxFavorableExcursionUsd =
                    Math.max(0, (excursion.high - entryPrice) * sizeCoins);
                  maxAdverseExcursionUsd =
                    Math.min(0, (excursion.low - entryPrice) * sizeCoins);
                } else {
                  maxFavorableExcursionUsd =
                    Math.max(0, (entryPrice - excursion.low) * sizeCoins);
                  maxAdverseExcursionUsd =
                    Math.min(0, (entryPrice - excursion.high) * sizeCoins);
                }
              }

              await supabase
                .from('trade_logs')
                .update({
                  status: finalStatus,
                  pnl_usd: finalPnl,
                  close_price: closePrice,
                  close_time: new Date(closeTs).toISOString(),
                  exit_reason: exitReason,
                  actual_holding_cycles: holdingCycles,
                  metric_version: 'live-ledger-excursion/v2',
                  pee_analyzed: false,
                  ...(maxFavorableExcursionUsd === null
                    ? {}
                    : {
                        max_favorable_excursion_usd:
                          maxFavorableExcursionUsd
                      }),
                  ...(maxAdverseExcursionUsd === null
                    ? {}
                    : {
                        max_adverse_excursion_usd:
                          maxAdverseExcursionUsd
                      })
                })
                .eq('id', log.id);

              console.log(
                `[✅ CLOSE RESOLVE] ${log.symbol} ${finalStatus} | ` +
                `PnL=$${finalPnl.toFixed(2)} ` +
                `(gross=${grossPnl.toFixed(4)}, fee=${commission.toFixed(4)}, ` +
                `funding=${funding.toFixed(4)}) | ${exitReason}`
              );
            } catch (resolveErr) {
              console.error(`[❌ CLOSE RESOLVE ERROR] ${log.symbol}:`, resolveErr.message);
            }
          }
        }
      }
    } catch (e) {
      // Im lặng bỏ qua
    }
  }

  return { runLedgerStateSync };
}

import QuantMath from '../../../../src/domain/analytics/QuantMath.js';
import {
  BTC_REGIME_FRAMES,
  resolveBtcRegime,
  resolveBtcStructure,
  classifyBtcBias,
  createBtcBiasStats,
  accumulateBtcBiasStats,
  formatBtcBiasSummary,
  buildBtcRegimeSnapshot
} from '../../domain/execution/btcRegimeFrame.js';
import {
  LIQUIDATION_PRESSURE_UNIT,
  LIQUIDITY_FEATURE_SCHEMA_VERSION,
  createLiquidityFeatureMetadata,
  encodeLiquidityLedgerEvent,
  withLiquidityFeatureVersion
} from '../../../../src/domain/analytics/quant/liquidityMetadata.js';
import { TradeValidator } from '../../../../src/domain/trading/TradeValidator.js';

// REVERT P0-2 (2026-08-13, owner directive): version engine hiện tại —
// đồng bộ với autoBot.js:474-476 (withLiquidityFeatureVersion('v1.5.2-auto')
// ghi trade_logs.strategy_version khi mở lệnh). Truyền vào evaluateGates
// để h2_realized (TELEMETRY only — gate OR) chỉ tính trên resolved logs
// cùng version, không trộn engine v1.3.x đã khai tử.
const CURRENT_ENGINE_STRATEGY_VERSION = 'v1.5.2-auto';
import {
  isNewEntrySymbolAllowed
} from '../../../../src/domain/trading/symbolEntryPolicy.js';
import {
  evaluateStrategyCandidates,
  getStrategyDefinition,
  resolveStrategyTierModel,
  routeAdaptiveStrategy,
  routeStrategy,
  selectStrategyLaneWinners
} from '../../../../src/domain/trading/strategyRouter.js';
import { POOL_SYMBOLS } from '../../../../src/shared/config/trading.js';
import {
  cancelTradeAlgoOrders
} from '../trading/orderOwnershipService.js';
import {
  makeExitClientOrderId
} from '../../domain/orders/trailingOrders.js';
import {
  createIntervalStats,
  accumulateIntervalStats,
  accumulateIntervalNearMiss,
  accumulateIntervalMsbRouting,
  selectLaneDropCounts,
  formatIntervalSummary,
  formatIntervalNearMiss,
  formatIntervalMsbRouting
} from './intervalRouterStats.js';
import { computeStructureStop } from '../../domain/execution/structureStopPolicy.js';
import {
  findNearestResistance,
  findNearestSupport
} from '../../../../src/domain/analytics/quant/structureLevels.js';

export function buildMarketDepthUrl(symbol) {
  return `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=500`;
}

// ============================================================
// R2 (2026-08-10): per-candidate near-miss diagnostics
// (spec 10_reachability_fix_spec.md §2). Hàm thuần export để test
// trực tiếp. accumulateNearMiss nhặt candidate KHÔNG match từ
// evaluateStrategyCandidates (đã trả diagnostics per candidate) và
// phân loại theo tầng fail đầu tiên: REGIME → TRIGGER → CONF.
// ============================================================

const NEAR_MISS_MIN_COUNT = (() => {
  const raw = Number(process?.env?.NEAR_MISS_MIN_COUNT);
  return Number.isFinite(raw) && raw >= 0 ? raw : 3;
})();

export function classifyNearMiss(diagnostics) {
  const confK = diagnostics.confirmationPassed;
  const confN = diagnostics.confirmationRequired;
  if (!diagnostics.regimePassed) {
    return { reason: 'REGIME', confK, confN };
  }
  if (!diagnostics.triggerPassed) {
    return { reason: 'TRIGGER', confK, confN };
  }
  return { reason: 'CONF', confK, confN };
}

export function accumulateNearMiss(allCandidates, statsMap) {
  for (const candidate of allCandidates || []) {
    const diagnostics = candidate?.diagnostics;
    if (!diagnostics || diagnostics.matched) continue;
    const { reason, confK, confN } = classifyNearMiss(diagnostics);
    let entry = statsMap.get(candidate.strategyId);
    if (!entry) {
      entry = {
        count: 0,
        byReason: { REGIME: 0, TRIGGER: 0, CONF: 0 },
        confDetail: new Map()
      };
      statsMap.set(candidate.strategyId, entry);
    }
    entry.count += 1;
    entry.byReason[reason] += 1;
    if (reason === 'CONF') {
      const combo = `${confK}/${confN}`;
      entry.confDetail.set(combo, (entry.confDetail.get(combo) || 0) + 1);
    }
  }
}

export function formatNearMissLine(
  statsMap,
  { minCount = NEAR_MISS_MIN_COUNT, top = 5 } = {}
) {
  const entries = [...(statsMap?.entries?.() || [])]
    .map(([strategyId, entry]) => ({ strategyId, ...entry }))
    .filter(entry => entry.count >= minCount)
    .sort((left, right) => right.count - left.count)
    .slice(0, top);
  if (entries.length === 0) return null;

  const parts = entries.map(({ strategyId, count, byReason, confDetail }) => {
    const topConf = [...(confDetail?.entries?.() || [])]
      .sort((left, right) => right[1] - left[1])[0];
    const confText = byReason.CONF > 0 && topConf
      ? `${byReason.CONF}(${topConf[0]})`
      : String(byReason.CONF);
    return (
      `${strategyId} x${count} ` +
      `(REGIME:${byReason.REGIME} TRIGGER:${byReason.TRIGGER} CONF:${confText})`
    );
  });
  return `[STRATEGY NEAR-MISS] ${parts.join(' | ')}`;
}

// F3 (P4): bỏ '5m' khỏi các interval tạo setup — 5m là nguồn lỗ cấu trúc
// (n=42, WR 28.6%, −8.29R). Klines 5m vẫn được fetch (klineIntervals) làm
// LTF reference cho MTF; chỉ không còn setup interval=5m.
export const TARGET_INTERVALS = ['15m', '1h', '4h', '1d'];

// F6/F7 (C1/C2): thay mockMathCore fake trong loop PENDING bằng tính THẬT.
// - C1: liqEstimate/liqSafetyMargin/leverageExceedsExchangeCap từ
//   QuantMath.estimateLiquidation + brackets hiện tại → gate h4 (TradeValidator)
//   đánh giá invalidation thật, không còn luôn fail hủy mọi PENDING.
//   Size ≤ 0 → liqEstimate null → h4 fail (hủy lệnh hỏng = đúng);
//   brackets thiếu → fail-open + console.warn (lệnh đã pass gate lúc đặt).
// - C2: trueEVValue ưu tiên pLog.true_ev (lưu lúc đặt lệnh), thiếu → tái tính
//   đúng công thức entry (prior 0.45) từ winRate/totalClosed. rr: 0 thật giữ 0,
//   null/''/invalid → 1.5.
export function computePendingOrderMathCore(pLog, {
  symbol,
  currentPrice,
  leverageBracketsRes,
  defaultBrackets,
  winRate,
  totalClosed
}) {
  // ---- C2: chuẩn hóa rr (0 thật giữ 0; null/''/invalid → 1.5) ----
  const rrIsMissing =
    pLog.rr === undefined || pLog.rr === null || pLog.rr === '';
  const pLogRrRaw = rrIsMissing ? 1.5 : parseFloat(pLog.rr);
  const pLogRr =
    Number.isFinite(pLogRrRaw) && pLogRrRaw >= 0 ? pLogRrRaw : 1.5;

  // ---- C2: EV thật (ưu tiên giá trị lưu lúc đặt; thiếu → tái tính công thức entry) ----
  const storedTrueEvRaw =
    pLog.true_ev === undefined || pLog.true_ev === null || pLog.true_ev === ''
      ? NaN
      : parseFloat(pLog.true_ev);
  let trueEVValue;
  if (Number.isFinite(storedTrueEvRaw)) {
    trueEVValue = storedTrueEvRaw;
  } else {
    const closedCount = Number.isFinite(totalClosed) ? totalClosed : 0;
    const evWinRate =
      closedCount < 30
        ? (0.45 * (30 - closedCount) + (winRate || 0) * closedCount) / 30
        : winRate;
    const evLossRate = 1 - evWinRate;
    trueEVValue = QuantMath.trueEV(evWinRate, pLogRr, evLossRate, 1);
    console.warn(
      `[DYNAMIC SHIELD] ${symbol}: true_ev thiếu trong trade_logs — tái tính EV=${trueEVValue.toFixed(3)} (winRate=${evWinRate.toFixed(3)}, rr=${pLogRr}).`
    );
  }

  // ---- C1: liquidation estimate thật ----
  const pLogEntry = parseFloat(pLog.entry);
  const pLogSl = parseFloat(pLog.sl);
  const pLogSize = parseFloat(pLog.position_size_usd);
  const pLogLevRaw =
    pLog.leverage === undefined || pLog.leverage === null || pLog.leverage === ''
      ? 1
      : parseFloat(pLog.leverage);
  const pLogLev =
    Number.isFinite(pLogLevRaw) && pLogLevRaw > 0 ? pLogLevRaw : 1;

  const brackets = Array.isArray(leverageBracketsRes)
    ? (leverageBracketsRes.find(b => b.symbol === symbol)?.brackets ||
        defaultBrackets)
    : defaultBrackets;
  const bracketsAvailable = Array.isArray(brackets) && brackets.length > 0;

  let liqEstimate = null;
  let leverageExceedsExchangeCap = false;
  let liqSafetyMargin = 0;

  if (!Number.isFinite(pLogSize) || pLogSize <= 0) {
    console.warn(
      `[DYNAMIC SHIELD] ${symbol}: position_size_usd không hợp lệ (${pLog.position_size_usd}) — h4 sẽ fail.`
    );
  } else if (bracketsAvailable) {
    const dir = pLog.direction === 'LONG' ? 'LONG' : 'SHORT';
    liqEstimate = QuantMath.estimateLiquidation(
      pLogSize,
      pLogLev,
      currentPrice,
      dir,
      brackets
    );
    if (liqEstimate) {
      if (pLogLev > liqEstimate.maxLevForTier) {
        // Cap sàn đổi từ lúc đặt -> invalidation THẬT
        leverageExceedsExchangeCap = true;
      }
      const liqDistancePct =
        Math.abs(currentPrice - liqEstimate.liqPrice) / currentPrice;
      const slDistPct =
        pLogEntry > 0 ? Math.abs(pLogEntry - pLogSl) / pLogEntry : 0;
      liqSafetyMargin = slDistPct > 0 ? liqDistancePct / slDistPct : 0;
    }
  } else {
    // Defensive: thiếu cấu hình brackets (defaultBrackets là const nên hầu như
    // không xảy ra). Lệnh đã pass gate lúc đặt; không có dữ liệu mới cho thấy
    // nguy hiểm -> fail-open + warn.
    console.warn(
      `[DYNAMIC SHIELD] ${symbol}: leverage brackets không khả dụng — bỏ qua gate h4 (fail-open).`
    );
    liqEstimate = { liqPrice: 0 };
    liqSafetyMargin = 1.3;
  }

  return {
    appliedRiskPercent: parseFloat(pLog.applied_risk_pct || 1),
    positionSizeUSD: pLogSize,
    theoreticalRR: pLogRr,
    trueEVValue,
    liqEstimate,
    leverageExceedsExchangeCap,
    liqSafetyMargin,
    dynamicSlDistance: Math.abs(pLogEntry - pLogSl),
    hasInsufficientMargin: false,
    hasMinNotionalError: false
  };
}

export function createMatrixScannerService(context) {
  const {
    btcReturnsCache,
    getConnectedClients,
    getCurrentAiModel,
    getGlobalMvrvZScore,
    getLiquidationSnapshot,
    marketDataCache,
    readBinanceReq,
    safeFetch,
    sendBinanceReq,
    supabase
} = context;

  // O1/O10 (team-D 2026-08-12): regime + dominance caches live at service
  // closure level so the HTTP snapshot endpoint can read them between scans.
  const btcDomCache = new Map();
  const btcRegimeCache = new Map();
  let lastBtcDomValue = null;

  async function runMatrixScanner() {
      console.log(`[RADAR] Bắt đầu chu kỳ quét Đa Khung Thời Gian (100% Dữ liệu thực)...`);
      const topSetups = [];
      const strategyDiagnostics = new Map();
      // R2 (2026-08-10): reset mỗi cycle — accumulate near-miss của candidates
      // không match; log 1 dòng tổng hợp cuối cycle (chống spam per-candidate).
      const nearMissStats = new Map();
      // F-E1a (2026-08-12): interval-level routing measurement (shadow only).
      const intervalStats = createIntervalStats();
      // F-E1b (2026-08-12): per-cycle BTC bias distribution (shadow only).
      const btcBiasStats = createBtcBiasStats();
      // F-E2b (2026-08-12): per-cycle SL structure LIVE counters — đo hiệu
      // ứng thật (slTech đã wire vào structure stop khi applied='STRUCTURE').
      const slShadowStats = {
          routed: 0,
          wouldTighten: 0,
          tighteningAtrSum: 0,
          sizeDeltaSum: 0
      };

      // O10: closure caches are per-cycle, snapshot getter reads latest cycle.
      btcDomCache.clear();
      btcRegimeCache.clear();
      lastBtcDomValue = null;
  
      try {
          // [VÁ LỖI 1]: Chỉ lấy các lệnh trong 12h qua để check Gate Cooldown chính xác nhất, tránh bị trôi dữ liệu khi limit(200)
          const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
          // P0-2 (2026-08-13): resolved logs 90 ngày (WIN/LOSS) cho h2_realized —
          // granularity global-direction (LONG n=94, SHORT n=134 — đủ cả 2).
          // Guard pnl_usd + risk_amount_usd > 0 ở bước lọc sau query.
          const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  
          const [ticker24hAll, premiumIndexAll, bookTickerAll, cmcData, accountInfo, leverageBracketsRes, tradeFeesRes, { data: tradeLogs }, exchangeInfoRes, positionsRisk, { data: resolvedTradeLogs }] = await Promise.all([
              marketDataCache.getTicker24hAll() ||
                safeFetch('https://fapi.binance.com/fapi/v1/ticker/24hr'),
              marketDataCache.getPremiumIndexAll() ||
                safeFetch('https://fapi.binance.com/fapi/v1/premiumIndex'),
              marketDataCache.getBookTickerAll() ||
                safeFetch('https://fapi.binance.com/fapi/v1/ticker/bookTicker'),
              safeFetch('http://localhost:1338/api/cmc'),
              readBinanceReq('/fapi/v2/account'),
              readBinanceReq('/fapi/v1/leverageBracket'), 
              readBinanceReq('/fapi/v1/commissionRate', { symbol: 'BTCUSDT' }),
              supabase.from('trade_logs')
          .select('*')
          .or(`status.in.(OPEN,PENDING),created_at.gte.${twelveHoursAgo}`)
          .order('created_at', { ascending: false }),
              safeFetch('https://fapi.binance.com/fapi/v1/exchangeInfo'),
              readBinanceReq('/fapi/v2/positionRisk'),
              supabase.from('trade_logs')
                  .select('*')
                  .or(`status.in.(WIN,LOSS),created_at.gte.${ninetyDaysAgo}`)
                  .order('created_at', { ascending: false })
          ]);
  
          // P0-2 (2026-08-13): guard resolved logs — chỉ giữ rows có pnl_usd
          // hợp lệ và risk_amount_usd > 0 (mẫu số R-multiple).
          const resolvedTradeLogsClean = (resolvedTradeLogs || []).filter(t =>
              t.pnl_usd !== null && t.pnl_usd !== undefined &&
              Number.isFinite(Number.parseFloat(t.pnl_usd)) &&
              Number.parseFloat(t.risk_amount_usd) > 0
          );
  
          const premiumMap = new Map((premiumIndexAll || []).map(i => [i.symbol, i]));
          const bookMap = new Map((bookTickerAll || []).map(i => [i.symbol, i]));
  
          const minNotionalMap = new Map();
          const tickSizeMap = new Map(); // F-E2a: PRICE_FILTER tickSize cho structure shadow buffer (2*tickSize)
          const matureSymbols = new Set(); // BỘ LỌC TUỔI ĐỜI COIN
          const legacySymbols = new Set();
          const MATURE_AGE_MS = 730 * 24 * 60 * 60 * 1000; // Yêu cầu coin phải sống sót ít nhất 2 năm
          const LEGACY_AGE_MS = 1460 * 24 * 60 * 60 * 1000;
          const nowMs = Date.now();
  
          if (exchangeInfoRes && exchangeInfoRes.symbols) {
              exchangeInfoRes.symbols.forEach(sym => {
                  // 1. Tính toán Min Notional
                  const notionalFilter = sym.filters.find(f => f.filterType === 'MIN_NOTIONAL');
                  if (notionalFilter) {
                      const baseVal = parseFloat(notionalFilter.notional || 5);
                      let bufferedVal;
                      if (baseVal <= 5) bufferedVal = baseVal + 0.3;
                      else if (baseVal <= 10) bufferedVal = baseVal + 1.0;
                      else if (baseVal <= 20) bufferedVal = baseVal + 2.0;
                      else if (baseVal >= 50) bufferedVal = baseVal + 5.0;
                      else bufferedVal = baseVal * 1.1; 
                      minNotionalMap.set(sym.symbol, bufferedVal);
                  }
  
                  // 2. Thu thập các Coin đã trưởng thành
                  if (sym.onboardDate) {
                      if ((nowMs - sym.onboardDate) > MATURE_AGE_MS) matureSymbols.add(sym.symbol);
                      if ((nowMs - sym.onboardDate) > LEGACY_AGE_MS) legacySymbols.add(sym.symbol);
                  }

                  // 3. Thu thập tick size (PRICE_FILTER) cho structure shadow
                  // buffer max(0.05*ATR, 2*tickSize) — structureStopPolicy.js.
                  const priceFilter = sym.filters.find(f => f.filterType === 'PRICE_FILTER');
                  if (priceFilter && priceFilter.tickSize) {
                      const tick = parseFloat(priceFilter.tickSize);
                      if (Number.isFinite(tick) && tick > 0) {
                          tickSizeMap.set(sym.symbol, tick);
                      }
                  }
              });
          }
  
          // DANH SÁCH ĐEN MEME COIN (Bắt buộc giữ lại)
          const eligiblePoolSymbols = POOL_SYMBOLS.filter(
              isNewEntrySymbolAllowed
          );
          let scanPool = eligiblePoolSymbols;
          if (ticker24hAll && Array.isArray(ticker24hAll)) {
              // 1. TẠO BỘ LỌC GỐC (Bỏ Meme, Bỏ râu nến dài, Bỏ coin rác)
              const baseTickers = ticker24hAll.filter(t => 
                  t.symbol.endsWith('USDT') && 
                  !POOL_SYMBOLS.includes(t.symbol) && 
                  isNewEntrySymbolAllowed(t.symbol) &&
                  Math.abs(parseFloat(t.priceChangePercent)) < 15 && 
                  ((parseFloat(t.highPrice) - parseFloat(t.lowPrice)) / parseFloat(t.lowPrice) * 100) < 25
              );
  
              // 2. NGÁCH TRENDING (30 Slot): > 2 năm tuổi, Volume > 30 Triệu USD
              const trendingTickers = baseTickers
                  .filter(t => matureSymbols.has(t.symbol) && parseFloat(t.quoteVolume) > 30000000)
                  .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
                  .slice(0, 30)
                  .map(t => t.symbol);
  
              // 3. NGÁCH LEGACY TECH (10 Slot): > 4 năm tuổi (DASH, NEO, ZEN...), Volume > 5 Triệu USD
              const legacyTickers = baseTickers
                  .filter(t => legacySymbols.has(t.symbol) && 
                               !trendingTickers.includes(t.symbol) &&
                               parseFloat(t.quoteVolume) > 5000000)
                  .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
                  .slice(0, 10)
                  .map(t => t.symbol);
              
              // 4. [BẢN VÁ TỬ HUYỆT]: Trích xuất các Coin đang có lệnh để Radar KHÔNG BAO GIỜ bỏ rơi
              const activeTrackingSymbols = [...new Set((tradeLogs || [])
                  .filter(t => t.status === 'PENDING' || t.status === 'OPEN')
                  .map(t => t.symbol)
              )];
  
              // 5. GỘP TOÀN BỘ VÀO RADAR (Pool cứng + Trending + Legacy + ĐANG THEO DÕI)
              scanPool = [...new Set([...eligiblePoolSymbols, ...trendingTickers, ...legacyTickers, ...activeTrackingSymbols])];
          }
  
          const liveCapital = accountInfo?.totalMarginBalance ? parseFloat(accountInfo.totalMarginBalance) : 0;
          const availableBal = accountInfo?.availableBalance ? parseFloat(accountInfo.availableBalance) : 0; // Kéo số dư thực tế
          const activeMakerFee = tradeFeesRes ? parseFloat(tradeFeesRes.makerCommissionRate) : 0.0002;
          const activeTakerFee = tradeFeesRes ? parseFloat(tradeFeesRes.takerCommissionRate) : 0.0004;
  
          const rawBtcDomValue = cmcData?.btcDominance ?? null;
          // O10: record raw (pre-fallback) value for the snapshot endpoint.
          if (rawBtcDomValue !== null) lastBtcDomValue = rawBtcDomValue;
          const btcDomValue = rawBtcDomValue ?? 55.0;
          const fgiValue = cmcData?.fgiValue || 50;
          
          const now = new Date();
          const utcHour = now.getUTCHours();
          const day = now.getUTCDay();
          let tradingSession = 'ASIAN'; let sessionMultiplier = 0.8; 
          if (utcHour >= 8 && utcHour < 13) { tradingSession = 'LONDON'; sessionMultiplier = 1.2; }
          if (utcHour >= 13 && utcHour < 21) { tradingSession = 'NEW_YORK'; sessionMultiplier = 1.5; }
          if (day === 0 || day === 6) sessionMultiplier *= 0.5;
  
const targetIntervals = TARGET_INTERVALS;

          const requiredMtfIntervals = ['15m', '1h', '4h', '1d', '1w'];
          
          await Promise.all(requiredMtfIntervals.map(async (mtf) => {
               try {
                   const domKlines = await marketDataCache.getKlines('BTCDOMUSDT', mtf, 25);
                   let slope = 0;
                   if (domKlines && domKlines.length >= 2) {
                        const domCloses = domKlines.map(d => parseFloat(d[4]));
                        const domIndexValue = domCloses[domCloses.length - 1];
                        slope = ((domIndexValue - domCloses[0]) / domCloses[0]) * 100;
                   }
                   btcDomCache.set(mtf, { slope });
                } catch (e) {
                    btcDomCache.set(mtf, { slope: 0 });
                }
          }));
  
btcReturnsCache.clear();
          // O1 (team-D 2026-08-12): regime cache only tracks the FIXED
          // 4h/1d frames — never the trade's own interval. Returns stays
          // per-interval (used by ISI at the per-symbol scan).
          for (const interval of BTC_REGIME_FRAMES) {
               const btcKlines = await marketDataCache.getKlines('BTCUSDT', interval, 250);
               let returns = [];
               if (btcKlines && btcKlines.length > 1) {
                   const closes = btcKlines.map(d => parseFloat(d[4]));
                   const highs = btcKlines.map(d => parseFloat(d[2]));
                   const lows = btcKlines.map(d => parseFloat(d[3]));
                   for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i-1]) / closes[i-1]);
                   const btcStructure = QuantMath.detectMarketStructure(
                       highs,
                       lows,
                       closes
                   );
                   // F-E1b (2026-08-12): cache stores the full structure
                   // (regime + MSB + SFP + swing levels) — null-guarded for
                   // the early-return shape (regime 'Sideways', msbState
                   // 'None', key 'sfp' missing lastSL/lastSH, indicators.js:
                   // 354-360). isSFP is a STRING ('Bearish_SFP'/'Bullish_SFP')
                   // or falsy — normalized to string|null here.
                   btcRegimeCache.set(
                       interval,
                       {
                           regime: btcStructure?.regime ?? null,
                           msbState: btcStructure?.msbState ?? null,
                           isSFP: typeof btcStructure?.isSFP === 'string'
                               ? btcStructure.isSFP
                               : null,
                           lastSL: btcStructure?.lastSL ?? null,
                           lastSH: btcStructure?.lastSH ?? null
                       }
                   );
               } else {
                   btcRegimeCache.set(interval, null);
               }
               btcReturnsCache.set(interval, returns);
          }
  
          const defaultBrackets = [{ bracket: 1, initialLeverage: 125, notionalCap: 50000, notionalFloor: 0, maintMarginRatio: 0.004 }];
  
          // [VÁ LỖI 2]: CHUNKING BATCHING CHỐNG NGHẼN API
          const CHUNK_SIZE = 4; // Quét 4 coin cùng lúc (Tối đa 12 requests futures/s)
          
          for (let i = 0; i < scanPool.length; i += CHUNK_SIZE) {
              const chunk = scanPool.slice(i, i + CHUNK_SIZE);
              
              await Promise.all(chunk.map(async (symbol) => {
  
                  let totalWinR = 0, winCount = 0, totalLossR = 0, lossCount = 0;
                  const coinLogs = (tradeLogs || []).filter(t => t.symbol === symbol);
                  
                  coinLogs.forEach(t => {
                      if (t.status === 'WIN' || t.status === 'LOSS') {
                          const rMultiple = (parseFloat(t.pnl_usd) || 0) / (parseFloat(t.risk_amount_usd) || 1);
                          if (t.pnl_usd > 0) { totalWinR += rMultiple; winCount++; }
                          if (t.pnl_usd <= 0) { totalLossR += Math.abs(rMultiple); lossCount++; }
                      }
                  });
                  
                  const totalClosed = winCount + lossCount;
                  const winRate = totalClosed > 0 ? winCount / totalClosed : 0;
                  const avgWinR = winCount > 0 ? (totalWinR / winCount) : 0;
                  const avgLossR = lossCount > 0 ? (totalLossR / lossCount) : 1; 
                  const historicalRR = avgLossR > 0 ? (avgWinR / avgLossR) : 0;
  
                  let fundingSlopeValue = 0;
                  let fundingRatesHistory = [];
                  let fundingSlopesHistory = [];
                  try {
                      const fundingHist = await safeFetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=10`);
                      if (fundingHist && fundingHist.length >= 3) {
                          fundingRatesHistory = fundingHist.map(
                              item => parseFloat(item.fundingRate) * 100
                          );
                          for (let fundingIndex = 2; fundingIndex < fundingRatesHistory.length; fundingIndex++) {
                              fundingSlopesHistory.push(
                                  fundingRatesHistory[fundingIndex] -
                                  fundingRatesHistory[fundingIndex - 2]
                              );
                          }
                          fundingSlopeValue = fundingSlopesHistory.at(-1) || 0;
                      }
                  } catch (error) {
                      console.warn(`[SCANNER FUNDING HISTORY] ${symbol}:`, error.message);
                  }
  
                  const klineIntervals = ['5m', '15m', '1h', '4h', '1d', '1w', '1M'];
                  const klinesCache = {};
                  
                  try {
                      const klinesPromises = klineIntervals.map(inv =>
                        marketDataCache.getKlines(symbol, inv, 250)
                      );
                      const klinesResults = await Promise.all(klinesPromises);
                      klineIntervals.forEach((inv, idx) => { klinesCache[inv] = klinesResults[idx]; });
                  } catch (err) { return; }

                  const depthData = await safeFetch(
                    buildMarketDepthUrl(symbol)
                  );
  
                  for (const interval of targetIntervals) {
                      try {
                          let mtfInterval = '1h'; let htfInterval = '4h'; let macroInterval = interval;
                          if (interval === '5m') { mtfInterval = '15m'; htfInterval = '1h'; }
                          else if (interval === '15m') { mtfInterval = '1h'; htfInterval = '4h'; }
                          else if (interval === '1h') { mtfInterval = '4h'; htfInterval = '1d'; }
                          else if (interval === '4h') { mtfInterval = '1d'; htfInterval = '1w'; }
                          else if (interval === '1d') { mtfInterval = '1w'; htfInterval = '1M'; macroInterval = '1d'; }
  
                          const klinesLTF = klinesCache[interval];
                          const klinesMTF = klinesCache[mtfInterval];
                          const klinesHTF = klinesCache[htfInterval];
  
                          // [VÁ LỖI 3 TỬ HUYỆT]: Hạ klinesHTF.length từ < 10 xuống < 4. Khung D1 sẽ chết đứng nếu check 10 tháng nến!
                          if (!klinesLTF || !klinesMTF || !klinesHTF || klinesLTF.length < 100 || klinesMTF.length < 30 || klinesHTF.length < 4) continue;
  
                          const [
                              oiHist,
                              takerData,
                              lsPosData,
                              lsAccountData
                          ] = await Promise.all([
                              safeFetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${macroInterval}&limit=30`),
                              safeFetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=${macroInterval}&limit=1`),
                              safeFetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=${macroInterval}&limit=1`),
                              safeFetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${macroInterval}&limit=1`)
                          ]);
  
                          const opens = klinesLTF.map(d => parseFloat(d[1]));
                          const highs = klinesLTF.map(d => parseFloat(d[2]));
                          const lows = klinesLTF.map(d => parseFloat(d[3]));
                          const closes = klinesLTF.map(d => parseFloat(d[4]));
                          const baseVolumes = klinesLTF.map(d => parseFloat(d[5]));
                          const quoteVolumes = klinesLTF.map(d => parseFloat(d[7])); 

                          // Binance kline flow indicators use base volume. Quote
                          // volume is reserved for USD liquidity/turnover metrics.
                          const buyBaseVolumes = klinesLTF.map(d => parseFloat(d[9]));
                          const sellBaseVolumes = baseVolumes.map(
                              (volume, index) => Math.max(0, volume - buyBaseVolumes[index])
                          );
                          const vpinValue = QuantMath.vpin(
                              buyBaseVolumes,
                              sellBaseVolumes,
                              baseVolumes,
                              50
                          );
  
                          const closesMTF = klinesMTF.map(d => parseFloat(d[4]));
                          const closesHTF = klinesHTF.map(d => parseFloat(d[4]));
  
                          const currentPrice = closes[closes.length - 1];
                          const avgVolume20 = QuantMath.sma(
                              baseVolumes.slice(0, -1),
                              20
                          );
                          const avgQuoteVolume20 = QuantMath.sma(
                              quoteVolumes.slice(0, -1),
                              20
                          );
                          const htfSma200 = QuantMath.sma(closesHTF, 200);
  
                          // P1-2 (2026-08-13): realSpreadPct = null khi thiếu
                          // bookTick (KHÔNG default 0.05) — h1 fail-closed +
                          // classifyAssetTier không nâng tier + costDrag dùng
                          // spread tối đa (không phồng theoreticalRR).
                          let obi = 0.5; let realSpreadPct = null;
                          const bookTick = bookMap.get(symbol);
                          if (bookTick && bookTick.bidPrice && bookTick.askPrice) {
                              const bid = parseFloat(bookTick.bidPrice);
                              const ask = parseFloat(bookTick.askPrice);
                              if (bid > 0) realSpreadPct = ((ask - bid) / bid) * 100;
                              const bidQty = parseFloat(bookTick.bidQty || 0); const askQty = parseFloat(bookTick.askQty || 0);
                              if (bidQty + askQty > 0) obi = bidQty / (bidQty + askQty);
                          }
  
                          const takerBuySellRatio = takerData?.length ? parseFloat(takerData[0].buySellRatio) : 1.0;
                          const lsPositionVolRatio = lsPosData?.length ? parseFloat(lsPosData[0].longShortRatio) : 1.0;
                          
                          const premTick = premiumMap.get(symbol);
                          const fundingRateValue = premTick ? parseFloat(premTick.lastFundingRate) * 100 : 0.01;
                          const fundingRateRank = QuantMath.percentileRank(
                              fundingRateValue,
                              fundingRatesHistory.slice(0, -1)
                          );
                          const fundingSlopeRank = QuantMath.percentileRank(
                              fundingSlopeValue,
                              fundingSlopesHistory.slice(0, -1)
                          );
  
                          const oiValues = Array.isArray(oiHist) ? oiHist.map(d => parseFloat(d.sumOpenInterestValue) || 0) : [0];
                          const oiEma14 = QuantMath.ema(oiValues, 14) || oiValues[oiValues.length - 1] || 0;
                          let oiDelta = 0;
                          const oiDeltaHistory = [];
                          for (let oiIndex = 1; oiIndex < oiValues.length; oiIndex++) {
                              const priorOi = oiValues[oiIndex - 1];
                              if (priorOi > 0) {
                                  oiDeltaHistory.push(
                                      ((oiValues[oiIndex] - priorOi) / priorOi) * 100
                                  );
                              }
                          }
                          if (oiValues.length >= 2) {
                              const prevOi = oiValues[oiValues.length - 2];
                              if (prevOi > 0) oiDelta = ((oiValues[oiValues.length - 1] - prevOi) / prevOi) * 100;
                          }
  
                          const longShortRatio = lsAccountData?.length
                              ? parseFloat(lsAccountData[0].longShortRatio)
                              : 1.0;
  
                          const atr14 = QuantMath.atr(highs, lows, closes, 14);
                          const rsi = QuantMath.rsi(closes, 14);
                          const adx = QuantMath.adx(highs, lows, closes, 14);
                          const cmf = QuantMath.cmf(highs, lows, closes, baseVolumes, 20);
                          
                          const atrHist = []; for(let j=14; j<closes.length; j++) atrHist.push(QuantMath.atr(highs.slice(0, j+1), lows.slice(0, j+1), closes.slice(0, j+1), 14));
                          const atrRank = QuantMath.percentileRank(atr14, atrHist.slice(-100));
  
                          const bbwHist = []; for (let j = 20; j < closes.length; j++) bbwHist.push(QuantMath.bollinger(closes.slice(0, j+1), 20, 2).bbw);
                          const bollinger20 = QuantMath.bollinger(closes, 20, 2);
                          const bbwRank = QuantMath.percentileRank(bollinger20.bbw, bbwHist.slice(-100));
                          const bbwSlope = bbwHist.length >= 5 ? ((bollinger20.bbw - bbwHist[bbwHist.length - 5]) / (bbwHist[bbwHist.length - 5] || 1)) * 100 : 0;
  
                          const scan20_50 = QuantMath.scanEmaRange(closesMTF, 20, 50, 20);
                          const scan50_200 = QuantMath.scanEmaRange(closesMTF, 50, 200, 20);
  
                         
  
                          const isBullishSFP = QuantMath.detectSFP_Institutional_Advanced(highs, lows, closes, opens, baseVolumes, avgVolume20, atr14, 'LONG');
                          const isBearishSFP = QuantMath.detectSFP_Institutional_Advanced(highs, lows, closes, opens, baseVolumes, avgVolume20, atr14, 'SHORT');
                          const msbData = QuantMath.detectMarketStructure(highs, lows, closes);
                          
  
                          const altReturns = [];
                          for (let j = 1; j < closes.length; j++) altReturns.push((closes[j] - closes[j-1]) / closes[j-1]);
  
                          const {
                              rank: amihudRank,
                              ready: amihudReady,
                              unit: amihudUnit,
                              value: amihudValue
                          } = QuantMath.amihudProfile(
                              altReturns.slice(0, -1),
                              quoteVolumes.slice(1, -1)
                          );
                          let isiValue = 0;
                          const btcReturnsCurrent = btcReturnsCache.get(interval);
  
                          if (btcReturnsCurrent && altReturns.length > 0) {
                              const minLen = Math.min(btcReturnsCurrent.length, altReturns.length);
                              const alignedBtc = btcReturnsCurrent.slice(-minLen);
                              const alignedAlt = altReturns.slice(-minLen);
                              
                              if (minLen > 10) {
                                  isiValue = QuantMath.immediateSensitivityIndicator(alignedAlt, alignedBtc, 5);
                              }
                          }
  
                          const btcDomData = btcDomCache.get(mtfInterval) || { slope: 0 };
                          const btcDomValue = cmcData?.btcDominance || 55.0;
                          const btcDomSlope = btcDomData.slope;
                          const macdValue = QuantMath.macd(closes, 12, 26, 9);
  
                          // 🧠 TÍNH TOÁN CÁC CHỈ BÁO LƯỢNG TỬ MỚI
                          const { currentCVD, cvdTrend } = QuantMath.cvd(baseVolumes, buyBaseVolumes, 50);
                          const { vwap, upper2, lower2 } = QuantMath.vwapWithBands(highs, lows, closes, baseVolumes, closes.length);
                          const hurstValue = QuantMath.hurst(closes, 100);
                          
            
                          let dynamicObi = obi; 
                          if (depthData && depthData.bids && depthData.asks) {
                              const scanDepthPct = (atr14 * 0.7) / currentPrice; 
                              dynamicObi = QuantMath.orderBookHeatmap(depthData.bids, depthData.asks, currentPrice, scanDepthPct);
                          }
                          const oiDeltaRank = QuantMath.percentileRank(
                              oiDelta,
                              oiDeltaHistory.slice(0, -1)
                          );

                          const apiMacro = {
                              realSpreadPct,
                              obi: dynamicObi,
                              takerBuySellRatio,
                              longShortRatio,
                              fgiValue,
                              tradingSession,
                              sessionMultiplier,
                              lsPositionVolRatio
                          };
  
                          // Kéo dữ liệu Cháy Tài Khoản
                          const liqData = getLiquidationSnapshot(symbol);
                          const liqPressure = QuantMath.liquidationPressure({
                              avgQuoteVolumePerCandle: avgQuoteVolume20,
                              interval,
                              longLiquidationUsd: liqData.longs,
                              observationReady: liqData.coverageReady,
                              shortLiquidationUsd: liqData.shorts,
                              windowMs: liqData.windowMs
                          });
                          // LÕI DATA NGUYÊN BẢN (KHÔNG CẮT XÉN)
                          const autoData = {
                              currentPrice, atr14, atrPercent: (atr14/currentPrice)*100, atrRank, bbwRank, bbw: bollinger20.bbw, bbwSlope, cmf, rsi, 
                              obi: dynamicObi, // ĐÃ NÂNG CẤP LÊN HEATMAP 1.5%
                              adx, vpinValue, 
                              cvdTrend, vwap, vwapUpper: upper2, vwapLower: lower2, hurstValue, // CÁC BIẾN MỚI
                              liqLongsVol: liqData.longs, liqShortsVol: liqData.shorts,
                              liqEventCount: liqData.eventCount,
                              liqLongRatio: liqPressure.longFlushRatio,
                              liqShortRatio: liqPressure.shortSqueezeRatio,
                              liqImbalance: liqPressure.imbalance,
                              liquidationCompleteness: liqData.completeness,
                              liquidationConnected: liqData.streamConnected,
                              liquidationCoverageMs: liqData.coverageMs,
                              liquidationCoverageReady: liqData.coverageReady,
                              liquidationCoverageStartedAt: liqData.coverageStartedAt,
                              liquidationNotionalUnit: liqData.notionalUnit,
                              liquidationObservedLowerBound: liqData.observedLowerBound,
                              liquidationPressureUnit: LIQUIDATION_PRESSURE_UNIT,
                              liquidationReady: liqPressure.ready,
                              liquidationSource: liqData.source,
                              liquidationWarmupRemainingMs: liqData.warmupRemainingMs,
                              liquidationWindowMs: liqData.windowMs,
                              liquidationUpdatedAt: liqData.updatedAt || 0,
                              liquidationStale:
                                  !liqPressure.ready ||
                                  liqData.eventCount === 0 ||
                                  Date.now() - (liqData.updatedAt || 0) > liqData.windowMs,
                              fundingRate: fundingRateValue,
                              fundingRateRank,
                              fundingSlope: fundingSlopeValue,
                              fundingSlopeRank,
                              lastClosedVolume: baseVolumes[baseVolumes.length - 2],
                              avgVolume20,
                              avgQuoteVolume20,
                              htfSma200,
                              ema20: { slope: scan20_50.fastSlope, value: scan20_50.fastEmaCurrent },
                              ema50: { slope: scan20_50.slowSlope, value: scan20_50.slowEmaCurrent },
                              ema200: { slope: scan50_200.slowSlope, value: scan50_200.slowEmaCurrent },
                              isBullishSFP, isBearishSFP,
                              amihud: amihudValue,
                              amihudRank,
                              amihudReady,
                              amihudUnit,
                              isi: isiValue,
                              currentVolume: baseVolumes[baseVolumes.length - 1],
                              liquidityMetricVersion:
                                  LIQUIDITY_FEATURE_SCHEMA_VERSION,
                              oiDelta,
                              oiDeltaRank,
                              isOiSpiking: oiValues[oiValues.length-1] > oiEma14,
                              btcDomValue,
                              btcDomSlope,
                              macd: macdValue,
                              msbRegime: msbData.regime, msbState: msbData.msbState, msbIsSFP: msbData.isSFP,
                              // F-E2a (2026-08-12): swing structure plumbing for
                              // the SL structure SHADOW — null-guarded for the
                              // detectMarketStructure early-return shape
                              // (missing lastSL/lastSH, indicators.js:354-360).
                              msbLastSL: msbData.lastSL ?? null,
                              msbLastSH: msbData.lastSH ?? null,
                              msbSwingAgeLong: msbData.lastSL
                                  ? closes.length - 1 - msbData.lastSL.index
                                  : null,
                              msbSwingAgeShort: msbData.lastSH
                                  ? closes.length - 1 - msbData.lastSH.index
                                  : null
                          };
                          autoData.liquidityFeatureMetadata =
                              createLiquidityFeatureMetadata(autoData);
  
                          const vectorRegime = QuantMath.evaluateVectorState(autoData, apiMacro, getGlobalMvrvZScore(), symbol);
                          const vectorDetails = vectorRegime.details;
                          const { l1, l2 } = vectorDetails;
                          
                          let realUsdVolume24h = 0;
                          if (ticker24hAll && Array.isArray(ticker24hAll)) {
                              const tData = ticker24hAll.find(t => t.symbol === symbol);
                              if (tData) realUsdVolume24h = parseFloat(tData.quoteVolume);
                          }
                          const intervalMinutes = {
                              '5m': 5,
                              '15m': 15,
                              '1h': 60,
                              '4h': 240,
                              '1d': 1440
                          };
                          const candlesPerDay = 1440 / (intervalMinutes[interval] || 60);
                          if (!realUsdVolume24h) {
                              realUsdVolume24h = (autoData.avgQuoteVolume20 || 0) * candlesPerDay;
                          }
                          const assetTier = QuantMath.classifyAssetTier(symbol, realUsdVolume24h, apiMacro.realSpreadPct);
  
                          // 🚨 HỆ THỐNG CỨU HỘ ĐA TẦNG (ORDER INVALIDATION ENGINE)
                          // VALID CHÉO: [1] Cấu trúc (MSB) + [2] Dòng tiền (CMF/VPIN) + [3] Động lượng (EMA/MACD)
                          const activePendingLogs = coinLogs.filter(t => t.status === 'PENDING' && t.interval === interval);
                          const activeOpenLogs = coinLogs.filter(t => t.status === 'OPEN' && t.interval === interval);
  
                          // KỊCH BẢN 1: TÁI CHẤM ĐIỂM & ĐÓNG DẤU DỮ LIỆU LỆNH PENDING (DYNAMIC RE-EVALUATION)
                          for (const pLog of activePendingLogs) {
                              // 1. Phục dựng lại Lõi Toán Học từ lệnh cũ với Dữ liệu Thị trường Tươi sống (Fresh Market Data)
                              const pLogEntry = parseFloat(pLog.entry);
                              const pLogSl = parseFloat(pLog.sl);
                              const pLogDir = pLog.direction;
                              const pLogTradeType = pLog.type || 'FUTURES';
  
                              const stratNameClean = pLog.strategy_name ? pLog.strategy_name.replace(' [BOT]', '') : "🤖 AI ADAPTIVE";
  
                              // 2. Chấm điểm lại (Softgate & Hardgate)
                              const pendingStrategy =
                                  getStrategyDefinition(stratNameClean) ||
                                  stratNameClean;
                              const pendingBaseScore = TradeValidator.evaluateScore(autoData, apiMacro, vectorDetails, pLogDir, getGlobalMvrvZScore(), symbol, null);
                              const pLogScore = {
                                  ...pendingBaseScore,
                                  passingScore: Math.max(
                                      pendingBaseScore.passingScore,
                                      pendingStrategy?.profile?.minScore || 50
                                  )
                              };
                              
                              // F6/F7 (C1/C2): math core THẬT từ dữ liệu trong scope
                              // (pLog + leverageBracketsRes/defaultBrackets + currentPrice
                              // + winRate/totalClosed) thay mock cứng: liqEstimate null →
                              // h4 luôn fail hủy mọi PENDING; autoData.true_ev || 1.0 → h2 luôn pass.
                              const mockMathCore = computePendingOrderMathCore(pLog, {
                                  symbol,
                                  currentPrice,
                                  leverageBracketsRes,
                                  defaultBrackets,
                                  winRate,
                                  totalClosed
                              });
  
                              // P1-2 (2026-08-13): gắn assetTier (pLog.asset_tier
                              // đã persist lúc đặt) vào strategy object để h1 áp
                              // spread cap theo tier; giữ nguyên contract cũ
                              // (string → strategyId; object → giữ policy).
                              const pendingStrategyForGates =
                                  typeof pendingStrategy === 'object' && pendingStrategy
                                      ? { ...pendingStrategy, assetTier: pLog.asset_tier || '' }
                                      : { strategyId: stratNameClean, assetTier: pLog.asset_tier || '' };

                              const pLogGates = TradeValidator.evaluateGates(autoData, apiMacro, vectorDetails, mockMathCore, pLogDir, pLogTradeType, pLogEntry, pLogSl, pLogScore, coinLogs, symbol, pendingStrategyForGates, resolvedTradeLogsClean, pLog.strategy_version);

                              // REVERT P0-2 (2026-08-13): h2_realized telemetry
                              // (shadow — gate OR, không chặn). Log per-candidate
                              // khi validator tính được (n ≥ 30 cùng version).
                              const h2PendingGate = pLogGates.hardGates.find(g => g.id === 'h2');
                              if (h2PendingGate?.h2_telemetry) {
                                  console.log(`[H2 REALIZED] direction=${pLogDir} version=${h2PendingGate.h2_telemetry.version} n=${h2PendingGate.h2_telemetry.n} EV=${h2PendingGate.h2_realized.toFixed(3)}R (telemetry only — gate OR)`);
                              }
  
                              // 3. RA QUYẾT ĐỊNH
                              if (!pLogGates.isApproved) {
                                  // RỚT ĐÀI: Gãy Hard Gate hoặc Softgate tụt thảm hại
                                  const failedHardGates = pLogGates.hardGates.filter(g => !g.passed).map(g => g.id).join(', ');
                                  const failReason = failedHardGates ? `HARD_GATES: ${failedHardGates}` : `SOFT_SCORE_LOW: ${pLogScore.score.toFixed(1)}`;
                                  
                                  console.log(`[🛡️ DYNAMIC SHIELD] Hủy lệnh PENDING ${symbol}. Bị rớt đài lúc chờ khớp! Lỗi: ${failReason}`);
                                  
                                  try {
                                      const algoCleanup = await cancelTradeAlgoOrders({
                                          log: pLog,
                                          sendBinanceReq
                                      });
                                      for (const failed of algoCleanup.failed) {
                                          console.warn(
                                              `[DYNAMIC SHIELD CO FAIL] ${symbol} ${failed.kind.toUpperCase()} ` +
                                              `code=${failed.code}: ${failed.message}`
                                          );
                                      }
                                      await sendBinanceReq('DELETE', '/fapi/v1/allOpenOrders', { symbol });
                                      await supabase.from('trade_logs').update({ 
                                          status: 'CANCELED', 
                                          exit_reason: `GATES_INVALIDATED [${failReason}]` 
                                      }).eq('id', pLog.id);
                                  } catch (error) {
                                      console.error(`[DYNAMIC SHIELD FAILURE] ${symbol}:`, error.message);
                                  }
                              } else {
                                  // VẪN PASS: Liên tục đóng dấu (Stamp) các thông số Lượng tử MỚI NHẤT vào Database
                                  // Đảm bảo lúc lệnh thực sự Khớp, dữ liệu trên DB phản ánh đúng giây phút đó!
                                  try {
                                      await supabase.from('trade_logs').update({
                                          adx: parseFloat(autoData.adx),
                                          atr: parseFloat(autoData.atr14),
                                          rsi: parseFloat(autoData.rsi),
                                          cmf: parseFloat(autoData.cmf),
                                          bbw_rank: parseInt(autoData.bbwRank),
                                          oi_delta: parseFloat(autoData.oiDelta || 0),
                                          funding_rate: parseFloat(fundingRateValue),
                                          funding_slope: parseFloat(fundingSlopeValue || 0),
                                          taker_ratio: parseFloat(apiMacro.takerBuySellRatio || 1),
                                          btc_dom_slope: parseFloat(autoData.btcDomSlope || 0),
regime_at_entry: vectorDetails?.l2 || autoData?.l2 || null,
                                          btc_regime_at_entry:
                                              resolveBtcRegime(btcRegimeCache, interval),
                                          vpin: parseFloat(autoData.vpinValue || 0),
                                          obi: parseFloat(dynamicObi || 0.5),
                                          amihud: parseFloat(amihudValue || 0),
                                          isi: parseFloat(isiValue || 0),
                                          cvd_trend: parseFloat(autoData.cvdTrend || 0),
                                          vwap: parseFloat(autoData.vwap || 0),
                                          vwap_upper: parseFloat(autoData.vwapUpper || 0),
                                          vwap_lower: parseFloat(autoData.vwapLower || 0),
                                          hurst_value: parseFloat(autoData.hurstValue || 0),
                                          liq_longs_vol: parseFloat(liqData.longs || 0),
                                          liq_shorts_vol: parseFloat(liqData.shorts || 0),
                                          soft_score: parseFloat(pLogScore.score),
                                          gate_s1: pLogScore.checks?.checkS1 === true,
                                          gate_s2: pLogScore.checks?.checkS2 === true,
                                          gate_s3: pLogScore.checks?.checkS3 === true,
                                          gate_s4: pLogScore.checks?.checkS4 === true,
                                          gate_s5: pLogScore.checks?.checkS5 === true,
                                          gate_s6: pLogScore.checks?.checkS6 === true,
                                          gate_s7: pLogScore.checks?.checkS7 === true,
                                          gate_s8: pLogScore.checks?.checkS8 === true,
                                          l1_structure: vectorDetails.l1, 
                                          l2_volatility: vectorDetails.l2, 
                                          l3_liq_event:
                                              encodeLiquidityLedgerEvent(
                                                  vectorDetails.l3,
                                                  autoData
                                              ),
                                          l4_positioning: vectorDetails.l4, 
                                          l5_momentum: vectorDetails.l5, 
                                          l6_macro: vectorDetails.l6,
                                          strategy_version:
                                              withLiquidityFeatureVersion(
                                                  pLog.strategy_version ||
                                                   'v1.5.2-pending'
                                              ),
                                          trend_sma200: autoData.currentPrice > autoData.htfSma200 ? 'UP' : 'DOWN'
                                      }).eq('id', pLog.id);
                                  } catch (error) {
                                      console.warn(`[PENDING SNAPSHOT UPDATE] ${symbol}:`, error.message);
                                  }
                              }
                          }

                          // KỊCH BẢN 2: THOÁT HIỂM KHẨN CẤP (PANIC SELL) CHO LỆNH ĐÃ KHỚP (OPEN)
                          // Cắt máu sớm (Chấp nhận lỗ 0.2R thay vì đợi SL mất 1.0R)
                          for (const oLog of activeOpenLogs) {
                              const isLong = oLog.direction === 'LONG';
                              const severeStructureBreak = isLong ? msbData.msbState === 'Bearish_MSB' : msbData.msbState === 'Bullish_MSB';
                              const severeFlow = isLong ? cmf < -0.05 : cmf > 0.05;
                              const priceLostEma50 = isLong ? currentPrice < scan20_50.slowEmaCurrent : currentPrice > scan20_50.slowEmaCurrent;
  
                              if (severeStructureBreak && severeFlow && priceLostEma50) {
                                  const position = positionsRisk?.find(p => p.symbol === symbol);
                                  if (position && parseFloat(position.positionAmt) !== 0) {
                                      const posAmt = parseFloat(position.positionAmt);
                                      // Valid hướng vị thế thực tế
                                      if ((isLong && posAmt > 0) || (!isLong && posAmt < 0)) {
                                          console.log(`[🚨 PANIC SELL] Vị thế ${symbol} gãy cấu trúc HTF! Nhảy tàu khẩn cấp!`);
                                           let closeAccepted = false;
                                           try {
                                               const closeSide = isLong ? 'SELL' : 'BUY';
                                               const { error: intentError } = await supabase
                                                   .from('trade_logs')
                                                   .update({
                                                       exit_reason:
                                                           'PANIC_SELL_REVERSAL_PENDING'
                                                   })
                                                   .eq('id', oLog.id);
                                               if (intentError) throw intentError;
                                              // Đóng Market chính xác số lượng đang cầm
                                              await sendBinanceReq('POST', '/fapi/v1/order', {
                                                   symbol: symbol,
                                                   side: closeSide,
                                                   type: 'MARKET',
                                                   quantity: Math.abs(posAmt),
                                                   reduceOnly: "true",
                                                   newClientOrderId:
                                                       makeExitClientOrderId(
                                                           'panic',
                                                           oLog.id
                                                       )
                                               });
                                               closeAccepted = true;
                                              // Xóa sổ các rào chắn SL/TP cũ
                                               const algoCleanup =
                                                   await cancelTradeAlgoOrders({
                                                       log: oLog,
                                                       sendBinanceReq
                                                   });
                                               for (const failed of algoCleanup.failed) {
                                                   console.warn(
                                                       `[PANIC CO FAIL] ${symbol} ` +
                                                       `${failed.kind.toUpperCase()} ` +
                                                       `code=${failed.code}: ${failed.message}`
                                                   );
                                               }
                                              // Ghi sổ cái
                                               const { error: closeLogError } =
                                                   await supabase
                                                       .from('trade_logs')
                                                       .update({
                                                           status: 'CLOSED',
                                                           close_price: currentPrice,
                                                           exit_reason:
                                                               'PANIC_SELL_REVERSAL'
                                                       })
                                                       .eq('id', oLog.id);
                                               if (closeLogError) {
                                                   throw closeLogError;
                                               }
                                           } catch(e) {
                                               if (!closeAccepted) {
                                                   await supabase
                                                       .from('trade_logs')
                                                       .update({ exit_reason: null })
                                                       .eq('id', oLog.id)
                                                       .eq('status', 'OPEN');
                                               }
                                              console.log(`Lỗi Panic Sell ${symbol}:`, e.message);
                                          }
                                      }
                                  }
                              }
                          }
  
                          const intervalCandidates = [];
                          const directions = ['LONG', 'SHORT'];
                          for (const direction of directions) {
                              const routeInput = {
                                  autoData,
                                  apiMacro,
                                  vectorDetails,
                                  direction,
                                  symbol,
                                  assetTier
                              };
                              // R2 (2026-08-10): tính candidates MỘT lần, vừa
                              // accumulate near-miss vừa truyền vào routeStrategy
                              // (tránh tính 2 lần + không phá API hiện có).
                              const allCandidates = evaluateStrategyCandidates(routeInput);
                              accumulateNearMiss(allCandidates, nearMissStats);
                              // F-E1a: per-interval near-miss (shadow only) —
                              // same first-failure-layer classification.
                              for (const candidate of allCandidates || []) {
                                  if (candidate?.diagnostics && !candidate.diagnostics.matched) {
                                      accumulateIntervalNearMiss(intervalStats, {
                                          interval,
                                          diagnostics: candidate.diagnostics
                                      });
                                  }
                              }
                              const primaryStrategy = routeStrategy(routeInput, { candidates: allCandidates });
                              // Shadow strategies are evaluated beside, not instead
                              // of, the existing live Adaptive lane.
                              const routedStrategies =
                                  primaryStrategy.rolloutMode === 'PAPER_ONLY'
                                      ? [
                                          primaryStrategy,
                                          routeAdaptiveStrategy(routeInput)
                                      ]
                                      : [primaryStrategy];

                              for (const routedStrategy of routedStrategies) {
                              const currentModel = getCurrentAiModel();
                              const matrixModel = resolveStrategyTierModel(
                                  currentModel,
                                  routedStrategy.strategyId,
                                  assetTier
                              );
                              const targetInfo = QuantMath.dynamicAsymmetricTargets(
                                  autoData,
                                  apiMacro,
                                  vectorDetails,
                                  direction,
                                  matrixModel,
                                  assetTier,
                                  routedStrategy,
                                  { symbol }
                              );
                              const {
                                  tpMult,
                                  slMult,
                                  strategyId,
                                  strategyDisplayName,
                                  execType,
                                  suggestedEntry
                              } = targetInfo;

                              const routeStats = strategyDiagnostics.get(strategyId) || {
                                  approved: 0,
                                  rejectedByGate: {},
                                  routed: 0,
                                  rolloutMode: targetInfo.rolloutMode
                              };
                              routeStats.routed += 1;
                              strategyDiagnostics.set(strategyId, routeStats);
                              // F-E1a: per-interval routed counter (shadow only).
                              accumulateIntervalStats(intervalStats, {
                                  interval,
                                  routedDelta: 1
                              });

                              // F-E1b (2026-08-12): fixed-frame BTC structure
                              // + 2-frame bias (payload + shadow only; never
                              // changes the live btcRegime string contract).
                              const btcStruct4h = resolveBtcStructure(btcRegimeCache, '4h');
                              const btcStruct1d = resolveBtcStructure(btcRegimeCache, '1d');
                              const btcRegime4h = btcStruct4h?.regime ?? null;
                              const btcRegime1d = btcStruct1d?.regime ?? null;
                              const btcBias = classifyBtcBias({
                                  direction,
                                  regime4h: btcRegime4h,
                                  regime1d: btcRegime1d
                              });
                              accumulateBtcBiasStats(btcBiasStats, {
                                  direction,
                                  regime4h: btcRegime4h,
                                  regime1d: btcRegime1d
                              });

                              // F-E3 (2026-08-12): TP/MSB shadow payload —
                              // nearest swing levels + MSB alignment, using
                              // the EXACT strategyRouter.js:338-343 mapping
                              // (LONG+Bullish_MSB, SHORT+Bearish_MSB). Never
                              // changes tp1 (line: tp1 stays tpMult*ATR).
                              const resistanceNear = findNearestResistance(
                                  highs,
                                  closes,
                                  suggestedEntry,
                                  { lookback: 40, atr: atr14 }
                              );
                              const supportNear = findNearestSupport(
                                  lows,
                                  closes,
                                  suggestedEntry,
                                  { lookback: 40, atr: atr14 }
                              );
                              const msbIsSFP = Boolean(msbData.isSFP);
                              const btcMsbAligned = direction === 'LONG'
                                  ? msbData.msbState === 'Bullish_MSB'
                                  : msbData.msbState === 'Bearish_MSB';
                              accumulateIntervalMsbRouting(intervalStats, {
                                  interval,
                                  aligned: btcMsbAligned,
                                  misaligned: !btcMsbAligned,
                                  sfpAtEntry: msbIsSFP
                              });

                              const baseSystemScore = TradeValidator.evaluateScore(
                                  autoData,
                                  apiMacro,
                                  vectorDetails,
                                  direction,
                                  getGlobalMvrvZScore(),
                                  symbol,
                                  null
                              );
                              const systemScoreTmp = {
                                  ...baseSystemScore,
                                  passingScore: Math.max(
                                      baseSystemScore.passingScore,
                                      targetInfo.minScore
                                  )
                              };

                              // F-E2b (2026-08-12): ATR-baseline stop — sizing
                              // LUÔN dùng distance ATR này (notional không tăng
                              // khi SL thật chặt hơn). slTech thật được quyết
                              // định sau computeStructureStop (STRUCTURE|ATR).
                              const slTechAtr = direction === 'LONG' ? suggestedEntry - (slMult * atr14) : suggestedEntry + (slMult * atr14);
                              const tp1 = direction === 'LONG' ? suggestedEntry + (tpMult * atr14) : suggestedEntry - (tpMult * atr14);
                              const riskDiffTechAtr = Math.abs(suggestedEntry - slTechAtr);

                              // F-E2a (2026-08-12): SL structure SHADOW — computes
                              // what the stop WOULD be off the last swing level.
                              // NEVER replaces slTech/riskDiffTech/size.
                              const slStructShadow = computeStructureStop({
                                  direction,
                                  entry: suggestedEntry,
                                  atr: atr14,
                                  slDistanceAtr: slMult,
                                  // F-E2a fix (2026-08-12): wire PRICE_FILTER
                                  // tickSize from exchangeInfo so the shadow
                                  // buffer uses max(0.05*ATR, 2*tickSize);
                                  // missing tick -> policy falls back to 0.05*ATR.
                                  tickSize: tickSizeMap.get(symbol),
                                  lastSL: autoData.msbLastSL ?? null,
                                  lastSH: autoData.msbLastSH ?? null,
                                  swingAge: direction === 'LONG'
                                      ? autoData.msbSwingAgeLong
                                      : autoData.msbSwingAgeShort,
                                  adx,
                                  msbRegime: msbData.regime,
                                  msbState: msbData.msbState
                              });
                              slShadowStats.routed += 1;
                              if (slStructShadow.applied === 'STRUCTURE') {
                                  slShadowStats.wouldTighten += 1;
                                  const tighteningAtr = atr14 > 0
                                      ? Math.abs(slStructShadow.slAtr - slStructShadow.slStruct) / atr14
                                      : 0;
                                  slShadowStats.tighteningAtrSum += tighteningAtr;
                                  if (slStructShadow.slAtr > 0) {
                                      const sizeDelta = (slStructShadow.distance / slStructShadow.slAtr) - 1;
                                      slShadowStats.sizeDeltaSum += sizeDelta;
                                  }
                                  console.log(
                                      `[SL STRUCTURE LIVE] ${symbol} ${interval} ${direction}: ` +
                                      `${slStructShadow.slAtr.toFixed(4)} -> ${slStructShadow.stopPrice.toFixed(4)} ` +
                                      `(${slStructShadow.reason}${slStructShadow.momentumSource ? ' ' + slStructShadow.momentumSource : ''})`
                                  );
                              }

                              // F-E2b (2026-08-12): SL structure LIVE — khi
                              // computeStructureStop applied='STRUCTURE' (level
                              // hợp lệ + momentum gate pass + không quá chặt),
                              // slTech THẬT = structure stop (chặt hơn ATR-SL).
                              // Ngược lại fail-open: giữ slTechAtr. riskDiffTech
                              // tính theo SL thật → theoreticalRR tăng; sizing
                              // giữ ATR-baseline (riskDiffTechAtr) nên notional
                              // KHÔNG tăng, risk thực giảm (owner decision
                              // 2026-08-12 + ref 02_money_management.md:20-23).
                              const slApplied = slStructShadow.applied === 'STRUCTURE'
                                  ? 'STRUCTURE'
                                  : 'ATR';
                              const slTech = slApplied === 'STRUCTURE'
                                  ? slStructShadow.stopPrice
                                  : slTechAtr;
                              const riskDiffTech = Math.abs(suggestedEntry - slTech);
  
                              let cRegime = 1.0
                              const l1Str = String(l1 || "");
                              if (l1Str.includes('Trend')) { cRegime = 1.2; } 
                              else if (l2 === 'Extreme') { cRegime = 0.5; } 
                              else { cRegime = 0.8; }
  
                              const tHold = QuantMath.calculateTemporalBarrier(
                                  interval,
                                  'FUTURES',
                                  direction,
                                  vectorDetails,
                                  assetTier,
                                  utcHour,
                                  targetInfo,
                                  targetInfo.tHoldModifier,
                                  // Wire btcTrendAlignment (report 36, 2026-08-12):
                                  // counter-BTC trades get shortened, aligned stay.
                                  // O1 (team-D 2026-08-12): regime from fixed 4h/1d
                                  // frames, never the trade interval.
                                  QuantMath.btcTrendAlignmentFor(
                                      direction,
                                      resolveBtcRegime(btcRegimeCache, interval)
                                  )
                              );
  
                              const minSafeAtr = 0.005; 
                              const isCompressed = l2 === 'Compression' || autoData.bbwRank < 20;
                              const effectiveAtrPercent = isCompressed ? Math.max(autoData.atrPercent, minSafeAtr * 100) * 1.5 : autoData.atrPercent;
                              const slippageBuffer = suggestedEntry * (effectiveAtrPercent / 100) * cRegime * sessionMultiplier; 
                              // F-E2b: sizing dùng ATR-baseline distance (không
                              // co theo structure stop) → positionSizeUSD giữ
                              // baseline, risk thực giảm vì SL thật chặt hơn.
                              const sizeSlDistance = riskDiffTechAtr + slippageBuffer; 
  
                              let slPercentForSize = sizeSlDistance / suggestedEntry;
                              if (!isFinite(slPercentForSize) || isNaN(slPercentForSize) || slPercentForSize === 0) slPercentForSize = 0.01;
  
                              const costDragLoss = QuantMath.costDrag(suggestedEntry, 'FUTURES', direction, execType, 'MARKET', fundingRateValue/100, realSpreadPct, tHold, activeMakerFee, activeTakerFee, interval, autoData.obi);
                              const costDragWin = QuantMath.costDrag(suggestedEntry, 'FUTURES', direction, execType, 'LIMIT', fundingRateValue/100, realSpreadPct, tHold, activeMakerFee, activeTakerFee, interval, autoData.obi);
                              const rewardDiff1 = Math.abs(tp1 - suggestedEntry);
                              
                              let theoreticalRR = riskDiffTech > 0 ? ((rewardDiff1 - costDragWin) / (riskDiffTech + costDragLoss)) : 0;
                              if (!isFinite(theoreticalRR) || isNaN(theoreticalRR) || theoreticalRR < 0) theoreticalRR = 0;
  
                              const bayesianPrior = 0.45; 
                              const effWinRate = totalClosed < 30 ? ((bayesianPrior * (30 - totalClosed) + (winRate || 0) * totalClosed) / 30) : winRate; 
                              const effLossRate = 1 - effWinRate;
                              const trueEVCalc = QuantMath.trueEV(effWinRate, theoreticalRR, effLossRate, 1);
                              const kellyDec = QuantMath.kellyCriterion(winRate, historicalRR, totalClosed);
  
                              const evalCapital = liveCapital > 0 ? liveCapital : 1000; 
                              // F1 (P1): bỏ riskMultiplier — appliedRiskPercent cố định bằng
                              // baseRiskPct (1.0). Score chỉ còn làm gate, không phóng đại size.
                              const baseRiskPct = 1.0;
                              let appliedRiskPercent = baseRiskPct;
  
                              let riskAmountUSD = evalCapital * (appliedRiskPercent / 100);
                              let positionSizeUSD = riskAmountUSD / slPercentForSize; 
                              if (!isFinite(positionSizeUSD) || isNaN(positionSizeUSD)) positionSizeUSD = 0;
  
                              const targetMinThreshold = minNotionalMap.get(symbol) || 5.3; 
                              if (positionSizeUSD > 0 && positionSizeUSD < targetMinThreshold) {
                                  positionSizeUSD = targetMinThreshold; 
                              }
  
                              let minRequiredLev = evalCapital > 0 ? positionSizeUSD / (evalCapital * 0.9) : 1;
                              let suggestedLeverage = Math.max(1, Math.ceil(minRequiredLev));
                              const marginUsedUSD = positionSizeUSD / suggestedLeverage; // Tính Margin thực tế
  
                              let liqEstimate = null; let leverageExceedsExchangeCap = false; let liqSafetyMargin = 0;
                              const brackets = Array.isArray(leverageBracketsRes) ? (leverageBracketsRes.find(b => b.symbol === symbol)?.brackets || defaultBrackets) : defaultBrackets;
  
                              if (brackets) {
                                  liqEstimate = QuantMath.estimateLiquidation(positionSizeUSD, suggestedLeverage, currentPrice, direction, brackets);
                                  if (liqEstimate) {
                                      if (suggestedLeverage > liqEstimate.maxLevForTier) {
                                          leverageExceedsExchangeCap = true; 
                                          suggestedLeverage = liqEstimate.maxLevForTier; 
                                          liqEstimate = QuantMath.estimateLiquidation(positionSizeUSD, suggestedLeverage, currentPrice, direction, brackets);
                                      }
                                      const liqDistancePct = Math.abs(currentPrice - liqEstimate.liqPrice) / currentPrice;
                                      const dynamicSlPct = sizeSlDistance / currentPrice; 
                                      liqSafetyMargin = dynamicSlPct > 0 ? (liqDistancePct / dynamicSlPct) : 0; 
                                  }
                              }
  
                              // [VÁ LỖI 4]: ĐỒNG BỘ HOÀN TOÀN CÁC CỜ MARGIN ĐỂ GATE H4 PASS Y HỆT TRÊN HUD
                              const mathCoreReal = { 
                                  appliedRiskPercent: appliedRiskPercent.toFixed(2),
                                  slPercentForSize: (slPercentForSize * 100).toFixed(2),
                                  riskAmountUSD: riskAmountUSD.toFixed(2),
                                  positionSizeUSD: positionSizeUSD.toFixed(2),
                                  suggestedLeverage, 
                                  theoreticalRR: theoreticalRR.toFixed(2), 
                                  trueEVValue: trueEVCalc.toFixed(3), 
                                  kellyPct: (kellyDec * 100).toFixed(2),
                                  liqEstimate, 
                                  liqSafetyMargin, 
                                  leverageExceedsExchangeCap,
                                  dynamicSlDistance: sizeSlDistance,
                                  hasInsufficientMargin: marginUsedUSD > availableBal, 
                                  hasMinNotionalError: riskAmountUSD > (evalCapital * 0.05),
                                  tHold
                              };
  
                              let finalTradeType = 'FUTURES';
                              let gates = TradeValidator.evaluateGates(autoData, apiMacro, vectorDetails, mathCoreReal, direction, 'FUTURES', suggestedEntry, slTech, systemScoreTmp, tradeLogs || [], symbol, targetInfo, resolvedTradeLogsClean, CURRENT_ENGINE_STRATEGY_VERSION);
                              
                              // REVERT P0-2 (2026-08-13): h2_realized telemetry
                              // (shadow — gate OR, không chặn). Log per-candidate
                              // khi validator tính được (n ≥ 30 cùng version).
                              const h2MainGate = gates.hardGates.find(g => g.id === 'h2');
                              if (h2MainGate?.h2_telemetry) {
                                  console.log(`[H2 REALIZED] direction=${direction} version=${h2MainGate.h2_telemetry.version} n=${h2MainGate.h2_telemetry.n} EV=${h2MainGate.h2_realized.toFixed(3)}R (telemetry only — gate OR)`);
                              }
                              
                              // Nếu Futures tịt vì Margin (Gate H4), thử nảy qua SPOT xem pass không!
                              if (direction === 'LONG' && !gates.isApproved && gates.hardGates.find(g => g.id === 'h4' && !g.passed)) {
                                  const spotGates = TradeValidator.evaluateGates(autoData, apiMacro, vectorDetails, mathCoreReal, direction, 'SPOT', suggestedEntry, slTech, systemScoreTmp, tradeLogs || [], symbol, targetInfo, resolvedTradeLogsClean, CURRENT_ENGINE_STRATEGY_VERSION);
                                  if (spotGates.isApproved) {
                                      gates = spotGates;
                                      finalTradeType = 'SPOT';
                                  }
                              }

                              if (!gates.isApproved) {
                                  for (const failedGate of gates.hardGates.filter(gate => !gate.passed)) {
                                      routeStats.rejectedByGate[failedGate.id] =
                                          (routeStats.rejectedByGate[failedGate.id] || 0) + 1;
                                  }
                                  if (gates.softScore < gates.passingScore) {
                                      routeStats.rejectedByGate.min_score =
                                          (routeStats.rejectedByGate.min_score || 0) + 1;
                                  }
                                  // F-E1a: per-interval rejection breakdown (shadow only).
                                  accumulateIntervalStats(intervalStats, {
                                      interval,
                                      rejectedGates: gates.hardGates.filter(gate => !gate.passed).map(gate => gate.id),
                                      minScoreFailed: gates.softScore < gates.passingScore
                                  });
                              }
                              
                              if (gates.isApproved) {
                                  routeStats.approved += 1;
                                  // F-E1a: per-interval approved counter (shadow only).
                                  accumulateIntervalStats(intervalStats, {
                                      interval,
                                      approvedDelta: 1
                                  });
                                  intervalCandidates.push({
                                      // DỮ LIỆU THỰC THI (Cho Binance)
                                      symbol, interval, direction, assetTier, tradeType: finalTradeType,
                                      entry: suggestedEntry.toFixed(4), slTech: slTech.toFixed(4), tp1: tp1.toFixed(4),
                                      theoreticalRR: theoreticalRR.toFixed(2),
                                      suggestedLeverage: finalTradeType === 'SPOT' ? 1 : Math.max(1, Math.ceil(sizeSlDistance / currentPrice * 100)),
                                      strategyId,
                                      strategyDisplayName,
                                      strategyFamily: targetInfo.family,
                                      strategyVersion: targetInfo.strategyVersion,
btcRegime:
                                          resolveBtcRegime(btcRegimeCache, interval),
                                      // F-E1b (2026-08-12): shadow payload —
                                      // fixed-frame structure + 2-frame bias.
                                      // btcRegime (string) stays untouched for
                                      // R2/bot compatibility.
                                      btcStructure4h: btcStruct4h
                                          ? { regime: btcStruct4h.regime, msbState: btcStruct4h.msbState }
                                          : null,
                                      btcStructure1d: btcStruct1d
                                          ? { regime: btcStruct1d.regime, msbState: btcStruct1d.msbState }
                                          : null,
                                      btcBias,
                                      btcBias4h: btcRegime4h,
                                      btcBias1d: btcRegime1d,
                                      // F-E2a/F-E2b (2026-08-12): SL structure —
                                      // slStructShadow là telemetry (structure
                                      // stop đề xuất); slApplied cho biết SL thật
                                      // đang dùng ('STRUCTURE'|'ATR'); slSizingDistance
                                      // là ATR-baseline distance dùng cho sizing.
                                      slStructShadow: {
                                          slStruct: slStructShadow.stopPrice,
                                          slAtr: slStructShadow.slAtr,
                                          applied: slStructShadow.applied,
                                          reason: slStructShadow.reason,
                                          bufferUsed: slStructShadow.bufferUsed
                                      },
                                      slApplied,
                                      slSizingDistance: riskDiffTechAtr,
                                      // F-E3 (2026-08-12): TP/MSB shadow payload.
                                      resistanceNear: resistanceNear
                                          ? { price: resistanceNear.price, index: resistanceNear.index, distAtr: resistanceNear.distAtr }
                                          : null,
                                      supportNear: supportNear
                                          ? { price: supportNear.price, index: supportNear.index, distAtr: supportNear.distAtr }
                                          : null,
                                      tp1DistAtr: atr14 > 0 ? rewardDiff1 / atr14 : null,
                                      msbIsSFP,
                                      msbRegime: msbData.regime ?? null,
                                      msbState: msbData.msbState ?? null,
                                      btcMsbAligned,
                                      rolloutMode: targetInfo.rolloutMode,
                                      executionMode: targetInfo.executionMode,
                                      strategyPriority: routedStrategy.priority,
                                      targetModelApplied: targetInfo.modelApplied,
                                      targetModelSampleSize: targetInfo.modelSampleSize,
                                      strategyConfidence:
                                          targetInfo.routeDiagnostics.confirmationRequired > 0
                                              ? Math.min(
                                                  1,
                                                  targetInfo.routeDiagnostics.confirmationPassed /
                                                  targetInfo.routeDiagnostics.confirmationRequired
                                              )
                                              : 0,
                                      matchedSignals: targetInfo.routeDiagnostics.confirmations
                                          .filter(item => item.passed)
                                          .map(item => item.id),
                                      overrideTag: strategyDisplayName,
                                      execType: execType,
                                      score: systemScoreTmp.score,
                                      tHold: tHold,
                                      tHoldModifier: targetInfo.tHoldModifier,
  
                                      // ==========================================
                                      // DỮ LIỆU ĐỂ BOT LƯU SUPABASE (CamelCase)
                                      // ==========================================
                                      adx: autoData.adx,
                                      atr: autoData.atr14,
                                      rsi: autoData.rsi,
                                      cmf: autoData.cmf,
                                      bbwRank: autoData.bbwRank,
                                      oiDelta: autoData.oiDelta || 0,
                                      // P2-2 (2026-08-13): isOiSpiking shadow —
                                      // OI hiện tại > OI EMA14 tại lúc quét.
                                      // KHÔNG wire trade logic; persist oi_spike
                                      // cần ALTER TABLE (xem local-daemon/sql/
                                      // add_missing_columns.sql) — proxy đã persist:
                                      // oi_delta lúc entry (autoBot.js:415).
                                      isOiSpiking: autoData.isOiSpiking === true,
                                      fundingRate: fundingRateValue,
                                      fundingSlope: fundingSlopeValue,
                                      takerRatio: apiMacro.takerBuySellRatio,
                                      btcDomSlope: autoData.btcDomSlope,
                                      mvrv: getGlobalMvrvZScore(),
                                      fgi: apiMacro.fgiValue,
                                      
                                      vpin: autoData.vpinValue,
                                      obi: autoData.obi,
                                      amihud: amihudValue,
                                      amihudRank: autoData.amihudRank,
                                      amihudReady: autoData.amihudReady,
                                      amihudUnit: autoData.amihudUnit,
                                      isi: isiValue,
                                      // 🚀 BỔ SUNG 7 BIẾN LƯỢNG TỬ TRUYỀN CHO BOT VÀO ĐÂY:
                                      cvdTrend: autoData.cvdTrend,
                                      vwap: autoData.vwap,
                                      vwapUpper: autoData.vwapUpper,
                                      vwapLower: autoData.vwapLower,
                                      hurstValue: autoData.hurstValue,
                                      liqLongsVol: autoData.liqLongsVol,
                                      liqShortsVol: autoData.liqShortsVol,
                                      liqEventCount: autoData.liqEventCount,
                                      liqLongRatio: autoData.liqLongRatio,
                                      liqShortRatio: autoData.liqShortRatio,
                                      liqImbalance: autoData.liqImbalance,
                                      liquidationCompleteness:
                                          autoData.liquidationCompleteness,
                                      liquidationConnected:
                                          autoData.liquidationConnected,
                                      liquidationCoverageMs:
                                          autoData.liquidationCoverageMs,
                                      liquidationCoverageReady:
                                          autoData.liquidationCoverageReady,
                                      liquidationNotionalUnit:
                                          autoData.liquidationNotionalUnit,
                                      liquidationObservedLowerBound:
                                          autoData.liquidationObservedLowerBound,
                                      liquidationPressureUnit:
                                          autoData.liquidationPressureUnit,
                                      liquidationReady:
                                          autoData.liquidationReady,
                                      liquidationSource:
                                          autoData.liquidationSource,
                                      liquidationStale:
                                          autoData.liquidationStale,
                                      liquidationUpdatedAt:
                                          autoData.liquidationUpdatedAt,
                                      liquidationWarmupRemainingMs:
                                          autoData.liquidationWarmupRemainingMs,
                                      liquidationWindowMs:
                                          autoData.liquidationWindowMs,
                                      liquidityFeatureMetadata:
                                          autoData.liquidityFeatureMetadata,
                                      featureSchemaVersion:
                                          LIQUIDITY_FEATURE_SCHEMA_VERSION,
                                      trueEV: mathCoreReal.trueEVValue,
                                      kellyPct: mathCoreReal.kellyPct,
                                      
                                      trendSma200: currentPrice > htfSma200 ? 'UP' : 'DOWN',
                                      session: apiMacro.tradingSession,
                                      marketRegime: vectorRegime.vector ? vectorRegime.vector.join(' | ') : '',
                                      l1: vectorDetails.l1, 
                                      l2: vectorDetails.l2, 
                                      l3: vectorDetails.l3,
                                      l4: vectorDetails.l4, 
                                      l5: vectorDetails.l5, 
                                      l6: vectorDetails.l6,
                                      
                                      gateS1: systemScoreTmp.checks.checkS1 || false,
                                      gateS2: systemScoreTmp.checks.checkS2 || false,
                                      gateS3: systemScoreTmp.checks.checkS3 || false,
                                      gateS4: systemScoreTmp.checks.checkS4 || false,
                                      gateS5: systemScoreTmp.checks.checkS5 || false,
                                      gateS6: systemScoreTmp.checks.checkS6 || false,
                                      gateS7: systemScoreTmp.checks.checkS7 || false,
                                      gateS8: systemScoreTmp.checks.checkS8 || false,
                                      
                                      epochId: getCurrentAiModel() ? 'epoch-matrix-active' : 'epoch-alpha-001'
                                  });
                              }
                              }
                          }
                          if (intervalCandidates.length > 0) {
                              // Keep one winner per execution lane. A shadow
                              // match must never suppress a valid live setup.
                              const laneWinners = selectStrategyLaneWinners(
                                  intervalCandidates
                              );
                              topSetups.push(...laneWinners);
                              // F-E1a: per-interval lane-drop measurement (shadow only).
                              const laneDropped = selectLaneDropCounts(
                                  intervalCandidates,
                                  laneWinners
                              );
                              for (const [dropInterval, dropCount] of Object.entries(laneDropped)) {
                                  accumulateIntervalStats(intervalStats, {
                                      interval: dropInterval,
                                      laneDropped: dropCount
                                  });
                              }
                          }
                      } catch (err) {
                          // Log ra terminal của VSCode/Node.js để track lỗi
                          console.warn(`[SCANNER DROP] Coin ${symbol} khung ${interval} bị loại do lỗi: ${err.message}`);
                      }
                  }
              }));
              
              // Nhịp nghỉ siêu nhỏ (300ms) để không dính Error WAF của Binance
              await new Promise(r => setTimeout(r, 300));
          }
  
          topSetups.sort((left, right) => {
              const scoreDelta =
                  (Number(right.score) || 0) -
                  (Number(left.score) || 0);
              if (scoreDelta !== 0) return scoreDelta;
              return (
                  (Number(right.theoreticalRR) || 0) -
                  (Number(left.theoreticalRR) || 0)
              );
          });
          const routerSummary = [...strategyDiagnostics.entries()]
              .sort((left, right) => right[1].routed - left[1].routed)
              .map(([strategyId, stats]) => {
                  const leadingRejection = Object.entries(stats.rejectedByGate)
                      .sort((left, right) => right[1] - left[1])[0];
                  const rejectionText = leadingRejection
                      ? `{${leadingRejection[0]}:${leadingRejection[1]}}`
                      : '';
                  return (
                      `${strategyId}:${stats.approved}/${stats.routed}` +
                      `${stats.rolloutMode === 'PAPER_ONLY' ? '[PAPER]' : ''}` +
                      rejectionText
                  );
              })
              .join(', ');
          console.log(`[STRATEGY ROUTER] approved/routed — ${routerSummary || 'no candidates'}`);
          const nearMissLine = formatNearMissLine(nearMissStats);
          if (nearMissLine) console.log(nearMissLine);
          // F-E1a (2026-08-12): interval-level routing summary + near-miss
          // (shadow only, đo lường nghi phạm 15m scanner→bot).
          const intervalSummaryLine = formatIntervalSummary(intervalStats);
          if (intervalSummaryLine) console.log(intervalSummaryLine);
          const intervalNearMissLine = formatIntervalNearMiss(intervalStats);
          if (intervalNearMissLine) console.log(intervalNearMissLine);
          // F-E3 (2026-08-12): per-interval MSB alignment shadow.
          const msbRoutingLine = formatIntervalMsbRouting(intervalStats);
          if (msbRoutingLine) console.log(msbRoutingLine);
          // F-E1b (2026-08-12): BTC bias distribution shadow (calibrate NEUTRAL rate).
          const btcBiasLine = formatBtcBiasSummary(btcBiasStats);
          if (btcBiasLine) console.log(btcBiasLine);
          // F-E2b (2026-08-12): SL structure LIVE cycle summary — counters
          // đo hiệu ứng THẬT (slTech đã wire), không còn shadow.
          if (slShadowStats.wouldTighten > 0) {
              const avgTighteningAtr = slShadowStats.tighteningAtrSum / slShadowStats.wouldTighten;
              const avgSizeDelta = slShadowStats.sizeDeltaSum / slShadowStats.wouldTighten;
              console.log(
                  `[SL STRUCTURE LIVE] cycle: tightened ${slShadowStats.wouldTighten}/${slShadowStats.routed} ` +
                  `avgTightening ${avgTighteningAtr.toFixed(2)} ATR ` +
                  `impliedSizeDelta ${(avgSizeDelta * 100).toFixed(1)}%`
              );
          }
          getConnectedClients().forEach(client => { if (client.readyState === 1) client.send(JSON.stringify({ type: 'SCAN_RESULTS', data: topSetups, isNewSignal: topSetups.length > 0 })); });
          console.log(`[RADAR] Chu kỳ hoàn tất. Bắt được ${topSetups.length} Setups trên ${scanPool.length} Coins (${TARGET_INTERVALS.length} Khung).`);
      } catch (e) { console.error("[RADAR] Lỗi Engine Scanner:", e); }
  }
  
  // BẢN VÁ: Vòng lặp đệ quy chống Kẹt xe Đa luồng (Overlapping Scanners)
  async function matrixScannerLoop() {
      await runMatrixScanner();
      setTimeout(matrixScannerLoop, 60000); // Chỉ bắt đầu đếm 60s SAU KHI đã quét xong hoàn toàn
  }

return {
    matrixScannerLoop,
    runMatrixScanner,
    // O10: read-only snapshot of the latest scan cycle's BTC regime state
    // (fixed 4h/1d frames per O1), read by GET /api/btc-regime.
    getBtcRegimeSnapshot: () => buildBtcRegimeSnapshot({
      regimeCache: btcRegimeCache,
      domCache: btcDomCache,
      btcDominance: lastBtcDomValue
    })
  };
}

import QuantMath from '../../../../src/domain/analytics/QuantMath.js';
import {
  LIQUIDATION_PRESSURE_UNIT,
  LIQUIDITY_FEATURE_SCHEMA_VERSION,
  createLiquidityFeatureMetadata
} from '../../../../src/domain/analytics/quant/liquidityMetadata.js';

export function createHudService(context) {
  const {
    btcReturnsCache,
    getLiquidationSnapshot,
    getMvrvState,
    getRateLimitState,
    marketDataCache,
    readBinanceReq,
    safeFetch,
    staticExchangeCache
  } = context;

  async function syncHUD(ws) {
      if (!ws.hudConfig || ws.hudSyncInFlight) return;
      ws.hudSyncInFlight = true;
      const { symbol, intervalTime, indicatorSpecs } = ws.hudConfig;
      
      try {
          let mtfInterval = '1h'; let htfInterval = '4h'; let macroInterval = intervalTime;
          if (intervalTime === '5m') { mtfInterval = '15m'; htfInterval = '1h'; }
          else if (intervalTime === '15m') { mtfInterval = '1h'; htfInterval = '4h'; }
          else if (intervalTime === '1h') { mtfInterval = '4h'; htfInterval = '1d'; }
          else if (intervalTime === '4h') { mtfInterval = '1d'; htfInterval = '1w'; }
          else if (intervalTime === '1d') { mtfInterval = '1w'; htfInterval = '1M'; macroInterval = '1d'; }
  
          const cacheKey = `static_${symbol}`;
          let leverageBracketsRes, tradeFeesRes;
          
          if (staticExchangeCache.has(cacheKey) && Date.now() - staticExchangeCache.get(cacheKey).ts < 3600000) {
               const cached = staticExchangeCache.get(cacheKey);
               leverageBracketsRes = cached.brackets;
               tradeFeesRes = cached.fees;
          } else {
               leverageBracketsRes = await readBinanceReq('/fapi/v1/leverageBracket', { symbol });
               tradeFeesRes = await readBinanceReq('/fapi/v1/commissionRate', { symbol });
               staticExchangeCache.set(cacheKey, { ts: Date.now(), brackets: leverageBracketsRes, fees: tradeFeesRes });
          }
  
          const [
              klinesLTF, klinesMTF, klinesHTF, fundingHist, oiCurrent, oiHist,
              lsAccData, lsPosData, takerData, positionsRisk, accountInfo,
              btcDomKlines, realBookTicker, realPremiumIndex, cmcDataRaw,
              ticker24hData
          ] = await Promise.all([
              marketDataCache.getKlines(symbol, intervalTime, 250),
              marketDataCache.getKlines(symbol, mtfInterval, 250),
              marketDataCache.getKlines(symbol, htfInterval, 250),
              safeFetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=10`),
              safeFetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
              safeFetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${macroInterval}&limit=30`),
              safeFetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${macroInterval}&limit=1`),
              safeFetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=${macroInterval}&limit=1`),
              safeFetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=${macroInterval}&limit=1`),
              readBinanceReq('/fapi/v2/positionRisk'),
              readBinanceReq('/fapi/v2/account'),
              marketDataCache.getKlines('BTCDOMUSDT', mtfInterval, 25),
              marketDataCache.getBookTicker(symbol) ||
                safeFetch(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${symbol}`),
              marketDataCache.getPremiumIndex(symbol) ||
                safeFetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
              safeFetch('http://localhost:1338/api/cmc'),
              marketDataCache.getTicker24h(symbol) ||
                safeFetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`)
          ]);
  
          if (!klinesLTF) return;
  
          const liveCapital = accountInfo?.totalMarginBalance ? parseFloat(accountInfo.totalMarginBalance) : 0;
          const availableBalance = accountInfo?.availableBalance ? parseFloat(accountInfo.availableBalance) : 0; 
          const binancePositions = positionsRisk && Array.isArray(positionsRisk) ? positionsRisk.filter(p => parseFloat(p.positionAmt) !== 0) : [];
          const leverageBrackets = Array.isArray(leverageBracketsRes) ? leverageBracketsRes[0]?.brackets : null;
          const tradeFees = tradeFeesRes ? { maker: parseFloat(tradeFeesRes.makerCommissionRate), taker: parseFloat(tradeFeesRes.takerCommissionRate) } : null;
          const cmcData = { btcDominanceRealtime: cmcDataRaw?.btcDominance || 55.0, fgiClassification: cmcDataRaw?.fgiClassification || 'NEUTRAL', totalMarketCapBillion: 0 };
  
          let realSpreadPct = 0.05; let obi = 0.5;
          if (realBookTicker && realBookTicker.bidPrice && realBookTicker.askPrice) {
              const bid = parseFloat(realBookTicker.bidPrice);
              const ask = parseFloat(realBookTicker.askPrice);
              if (bid > 0) realSpreadPct = ((ask - bid) / bid) * 100;
              const bidQty = parseFloat(realBookTicker.bidQty || 0); const askQty = parseFloat(realBookTicker.askQty || 0);
              if (bidQty + askQty > 0) obi = bidQty / (bidQty + askQty);
          }
  
          // [VÁ LỖI TỘI ĐỒ 3] ĐỒNG BỘ SESSION MULTIPLIER
          const now = new Date();
          const utcHour = now.getUTCHours();
          const day = now.getUTCDay();
          let tradingSession = 'ASIAN'; let sessionMultiplier = 0.8; 
          if (utcHour >= 8 && utcHour < 13) { tradingSession = 'LONDON'; sessionMultiplier = 1.2; }
          else if (utcHour >= 13 && utcHour < 21) { tradingSession = 'NEW_YORK'; sessionMultiplier = 1.5; }
          if (day === 0 || day === 6) sessionMultiplier *= 0.5;
  
          const apiMacro = {
              realSpreadPct, obi,
              longShortRatio: lsAccData?.length ? parseFloat(lsAccData[0].longShortRatio) : 1.0,
              lsPositionVolRatio: lsPosData?.length ? parseFloat(lsPosData[0].longShortRatio) : 1.0,
              takerBuySellRatio: takerData?.length ? parseFloat(takerData[0].buySellRatio) : 1.0,
              fgiValue: cmcDataRaw?.fgiValue || 50,
              tradingSession,
              sessionMultiplier
          };
  
          const opens = klinesLTF.map(d => parseFloat(d[1]));
          const highs = klinesLTF.map(d => parseFloat(d[2])); 
          const lows = klinesLTF.map(d => parseFloat(d[3]));
          const closes = klinesLTF.map(d => parseFloat(d[4])); 
          const baseVolumes = klinesLTF.map(d => parseFloat(d[5]));
          const quoteVolumes = klinesLTF.map(d => parseFloat(d[7]));

          // d[5]/d[9] use the base asset; d[7]/d[10] use the quote asset.
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
  
          const closesMTF = klinesMTF.map(d => parseFloat(d[4])); const closesHTF = klinesHTF.map(d => parseFloat(d[4]));
          
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
  
          const oiValues = Array.isArray(oiHist) ? oiHist.map(d => parseFloat(d.sumOpenInterestValue) || 0) : [0];
          const oiEma14 = QuantMath.ema(oiValues, 14) || oiValues[oiValues.length - 1] || 0;
          const currentOiValue = oiCurrent ? (parseFloat(oiCurrent.openInterest) * currentPrice) : 0;
          let oiDeltaPercent = 0;
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
             if (prevOi > 0) oiDeltaPercent = ((oiValues[oiValues.length - 1] - prevOi) / prevOi) * 100;
          }
          const oiDeltaRank = QuantMath.percentileRank(
              oiDeltaPercent,
              oiDeltaHistory.slice(0, -1)
          );
  
          const fundingRateValue = realPremiumIndex ? parseFloat(realPremiumIndex.lastFundingRate) * 100 : 0;
          const fundingRatesHistory = Array.isArray(fundingHist)
              ? fundingHist.map(item => parseFloat(item.fundingRate) * 100)
              : [];
          const fundingSlopesHistory = [];
          for (let fundingIndex = 2; fundingIndex < fundingRatesHistory.length; fundingIndex++) {
              fundingSlopesHistory.push(
                  fundingRatesHistory[fundingIndex] -
                  fundingRatesHistory[fundingIndex - 2]
              );
          }
          const fundingSlopeValue = fundingSlopesHistory.at(-1) || 0;
          const fundingRateRank = QuantMath.percentileRank(
              fundingRateValue,
              fundingRatesHistory.slice(0, -1)
          );
          const fundingSlopeRank = QuantMath.percentileRank(
              fundingSlopeValue,
              fundingSlopesHistory.slice(0, -1)
          );
  
          const atr14 = QuantMath.atr(highs, lows, closes, 14);
          const rsiValue = QuantMath.rsi(closes, indicatorSpecs.rsiPeriod);
          const adxValue = QuantMath.adx(highs, lows, closes, 14);
          const cmfValue = QuantMath.cmf(
              highs,
              lows,
              closes,
              baseVolumes,
              20
          );
  
          const atrHist = []; for(let i=14; i<closes.length; i++) atrHist.push(QuantMath.atr(highs.slice(0, i+1), lows.slice(0, i+1), closes.slice(0, i+1), 14));
          const atrRank = QuantMath.percentileRank(atr14, atrHist.slice(-100));
  
          const bbwHist = []; for (let i = indicatorSpecs.bbPeriod; i < closes.length; i++) bbwHist.push(QuantMath.bollinger(closes.slice(0, i+1), indicatorSpecs.bbPeriod, indicatorSpecs.bbStdDev).bbw);
          const bollinger20 = QuantMath.bollinger(closes, indicatorSpecs.bbPeriod, indicatorSpecs.bbStdDev);
          const bbwRank = QuantMath.percentileRank(bollinger20.bbw, bbwHist.slice(-100));
          const bbwSlopeValue = bbwHist.length >= 5 ? ((bollinger20.bbw - bbwHist[bbwHist.length - 5]) / (bbwHist[bbwHist.length - 5] || 1)) * 100 : 0;
  
          let btcDomSlope = 0; let btcDomValue = cmcData.btcDominanceRealtime;
          if (btcDomKlines && btcDomKlines.length >= 2) {
               const domCloses = btcDomKlines.map(d => parseFloat(d[4]));
               const domIndexValue = domCloses[domCloses.length - 1];
               btcDomSlope =
                   ((domIndexValue - domCloses[0]) / domCloses[0]) * 100;
          }
  
          const scan20_50 = QuantMath.scanEmaRange(closesMTF, 20, 50, 20);
          const scan50_200 = QuantMath.scanEmaRange(closesMTF, 50, 200, 20);
  
  
  
          const isBullishSFP = QuantMath.detectSFP_Institutional_Advanced(highs, lows, closes, opens, baseVolumes, avgVolume20, atr14, 'LONG');
          const isBearishSFP = QuantMath.detectSFP_Institutional_Advanced(highs, lows, closes, opens, baseVolumes, avgVolume20, atr14, 'SHORT');
  
          
          // [VÁ LỖI TỘI ĐỒ 1] THÊM THUẬT TOÁN MSB
          const msbData = QuantMath.detectMarketStructure(highs, lows, closes);
  
          const altReturns = [];
          for (let i = 1; i < closes.length; i++) altReturns.push((closes[i] - closes[i-1]) / closes[i-1]);
  
          const closedReturns = altReturns.slice(0, -1);
          const {
              rank: amihudRank,
              ready: amihudReady,
              unit: amihudUnit,
              value: amihudValue
          } = QuantMath.amihudProfile(
              closedReturns,
              quoteVolumes.slice(1, -1)
          );
          let isiValue = 0;
          const btcReturnsCurrent = btcReturnsCache.get(intervalTime);
  
          if (btcReturnsCurrent && altReturns.length > 0) {
              const minLen = Math.min(btcReturnsCurrent.length, altReturns.length);
              const alignedBtc = btcReturnsCurrent.slice(-minLen);
              const alignedAlt = altReturns.slice(-minLen);
              
              if (minLen > 10) {
                  isiValue = QuantMath.immediateSensitivityIndicator(alignedAlt, alignedBtc, 5);
              }
          }
          const macdValue = QuantMath.macd(closes, 12, 26, 9);
          const intervalMinutes = {
              '5m': 5,
              '15m': 15,
              '1h': 60,
              '4h': 240,
              '1d': 1440
          };
          const candlesPerDay =
              1440 / (intervalMinutes[intervalTime] || 60);
          const tickerQuoteVolume = Number.parseFloat(
              ticker24hData?.quoteVolume
          );
          const realUsdVol24h =
              Number.isFinite(tickerQuoteVolume) &&
              tickerQuoteVolume > 0
                  ? tickerQuoteVolume
                  : (avgQuoteVolume20 || 0) * candlesPerDay;
          // 🧠 TÍNH TOÁN CÁC CHỈ BÁO LƯỢNG TỬ MỚI CHO HUD
          const { currentCVD, cvdTrend } = QuantMath.cvd(baseVolumes, buyBaseVolumes, 50);
          // Đã áp dụng luôn Dải 2 (upper2, lower2) cho VWAP Gravity
          const { vwap, upper2, lower2 } = QuantMath.vwapWithBands(highs, lows, closes, baseVolumes, closes.length);
          const hurstValue = QuantMath.hurst(closes, 100);
          const liqData = getLiquidationSnapshot(symbol);
          const liqPressure = QuantMath.liquidationPressure({
              avgQuoteVolumePerCandle: avgQuoteVolume20,
              interval: intervalTime,
              longLiquidationUsd: liqData.longs,
              observationReady: liqData.coverageReady,
              shortLiquidationUsd: liqData.shorts,
              windowMs: liqData.windowMs
          });
          const autoData = {
              currentPrice, atr14, atrPercent: currentPrice > 0 ? (atr14 / currentPrice) * 100 : 0, atrRank,
              usdVolume24h: realUsdVol24h,
              adx: adxValue, htfSma200, rsi: rsiValue, bbwRank, bbw: bollinger20.bbw, cmf: cmfValue,
              ema20: { value: scan20_50.fastEmaCurrent, slope: scan20_50.fastSlope }, 
              ema34: { value: QuantMath.ema(closesMTF, 34), slope: 0 }, 
              ema50: { value: scan20_50.slowEmaCurrent, slope: scan20_50.slowSlope }, 
              ema89: { value: QuantMath.ema(closesMTF, 89), slope: 0 }, 
              ema200: { value: scan50_200.slowEmaCurrent, slope: scan50_200.slowSlope },
              scan20_50,
              scan50_200,
              fundingRate: fundingRateValue,
              fundingRateRank,
              fundingSlope: fundingSlopeValue,
              fundingSlopeRank,
              obi,
              bbwSlope: bbwSlopeValue,
              currentOi: currentOiValue,
              oiEma: oiEma14,
              oiDelta: oiDeltaPercent,
              oiDeltaRank,
              isOiSpiking: currentOiValue > oiEma14,
              currentVolume: baseVolumes[baseVolumes.length - 1],
              lastClosedVolume: baseVolumes[baseVolumes.length - 2],
              avgVolume20,
              avgQuoteVolume20,
              isBullishSFP, isBearishSFP,
              btcDomValue, btcDomSlope,
              vpinValue,
              amihud: amihudValue,
              amihudRank,
              amihudReady,
              amihudUnit,
              isi: isiValue,
              macd: macdValue,
              msbRegime: msbData.regime, msbState: msbData.msbState, msbIsSFP: msbData.isSFP, // Đã thêm MSB
              // 🚀 BẢN VÁ: Bơm dữ liệu Lượng tử vào HUD
              cvdTrend, 
              vwap, 
              vwapUpper: upper2, 
              vwapLower: lower2, 
              hurstValue, 
              liqLongsVol: liqData.longs, 
              liqShortsVol: liqData.shorts,
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
              liquidityMetricVersion:
                  LIQUIDITY_FEATURE_SCHEMA_VERSION
          };
          autoData.liquidityFeatureMetadata =
              createLiquidityFeatureMetadata(autoData);
  
          ws.send(JSON.stringify({ 
              type: 'HUD_SYNC', 
              payload: { autoData, apiMacro, liveCapital, availableBalance, binancePositions, leverageBrackets, tradeFees, cmcData, mvrvState: getMvrvState(), binanceRateLimit: getRateLimitState(), telemetryAt: Date.now() } 
          }));
  
      } catch (error) {
          console.error('[HUD] Lỗi tính toán:', error.message);
      } finally {
          ws.hudSyncInFlight = false;
      }
  }
  // =====================================================================
  // 🚀 ĐỘNG CƠ BẢO VỆ LỢI NHUẬN
  // =====================================================================

  return { syncHUD };
}

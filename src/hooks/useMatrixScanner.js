/// FILE: src/hooks/useMatrixScanner.js
import { useState, useEffect, useRef } from 'react';
import QuantMath from '../core/QuantMath';
import { POOL_INTERVALS, POOL_SYMBOLS } from '../config/constants';
import { TradeValidator } from '../core/TradeValidator';

export default function useMatrixScanner({ 
  liveCapital, autoData, mvrvZScore, tradeFees, apiMacro, showToast, 
  dynamicPool, dynamicMinNotionals, setSystemHealth, systemHealth, tradeLogs
}) {
  const [scannedTopSetups, setScannedTopSetups] = useState([]);
  const [isScanningBackground, setIsScanningBackground] = useState(false);
  const [sonarEnabled, setSonarEnabled] = useState(false);
  
  const prevScannedSigRef = useRef('');

  const liveCapitalRef = useRef(liveCapital);
  const autoDataRef = useRef(autoData);
  const mvrvZScoreRef = useRef(mvrvZScore);
  const tradeFeesRef = useRef(tradeFees);
  const apiMacroRef = useRef(apiMacro);
  const dynamicPoolRef = useRef(dynamicPool);
  const dynamicMinNotionalsRef = useRef(dynamicMinNotionals);
  
  const systemHealthRef = useRef(systemHealth);
  useEffect(() => { systemHealthRef.current = systemHealth; }, [systemHealth]);

  useEffect(() => { liveCapitalRef.current = liveCapital; }, [liveCapital]);
  useEffect(() => { autoDataRef.current = autoData; }, [autoData]);
  useEffect(() => { mvrvZScoreRef.current = mvrvZScore; }, [mvrvZScore]);
  useEffect(() => { tradeFeesRef.current = tradeFees; }, [tradeFees]);
  useEffect(() => { apiMacroRef.current = apiMacro; }, [apiMacro]);
  useEffect(() => { dynamicPoolRef.current = dynamicPool; }, [dynamicPool]);
  useEffect(() => { dynamicMinNotionalsRef.current = dynamicMinNotionals; }, [dynamicMinNotionals]);

  useEffect(() => {
    let isMounted = true;

    const fetchWithTimeout = async (url, ms = 15000) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), ms);
        try {
            const startPing = Date.now();
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(id);
            const latency = Date.now() - startPing;
            
            const weight = response.headers.get('x-mbx-used-weight-1m');
            if (weight && setSystemHealth && isMounted) {
               setSystemHealth(prev => ({ ...prev, weight: parseInt(weight, 10), latency }));
            }
            
            return response.ok ? await response.json() : [];
        } catch (error) {
            clearTimeout(id);
            return []; 
        }
    };

    const runCrossAssetScan = async () => {
      if (isScanningBackground) return;
      setIsScanningBackground(true);
      
      const currentDynamicPool = dynamicPoolRef.current || [];
      const currentMinNotionals = dynamicMinNotionalsRef.current || {};

      try {
        // Tối ưu Vercel Cache: Khóa chu kỳ vào block 30s
        const ts = Math.floor(Date.now() / 30000) * 30000;
        const scanResultsPool = [];
        const realtimeMetrics = {};
        
        try {
            const [allBook, allPrem] = await Promise.all([
                fetchWithTimeout(`/api/binance?path=/fapi/v1/ticker/bookTicker&t=${ts}`, 10000),
                fetchWithTimeout(`/api/binance?path=/fapi/v1/premiumIndex&t=${ts}`, 10000)
            ]);

            currentDynamicPool.forEach(sym => {
                const book = Array.isArray(allBook) ? allBook.find(b => b.symbol === sym) : null;
                const prem = Array.isArray(allPrem) ? allPrem.find(p => p.symbol === sym) : null;
                
                if (book && prem) {
                    const ask = parseFloat(book.askPrice);
                    const bid = parseFloat(book.bidPrice);
                    const bidQty = parseFloat(book.bidQty || 0);
                    const askQty = parseFloat(book.askQty || 0);
                    realtimeMetrics[sym] = {
                        spread: bid > 0 ? ((ask - bid) / bid) * 100 : 0.05,
                        obi: (bidQty + askQty > 0) ? bidQty / (bidQty + askQty) : 0.5,
                        funding: parseFloat(prem.lastFundingRate || 0)
                    };
                } else {
                    const defaultSpread = sym.includes('BTC') ? 0.01 : (sym.includes('ETH') || sym.includes('SOL') ? 0.02 : 0.05);
                    const defaultFunding = sym.includes('BTC') || sym.includes('ETH') ? 0.0001 : 0.0002;
                    realtimeMetrics[sym] = { spread: defaultSpread, obi: 0.5, funding: defaultFunding };
                }
            });
        } catch (e) {
            currentDynamicPool.forEach(sym => { realtimeMetrics[sym] = { spread: 0.05, obi: 0.5, funding: 0.0002 }; });
        }

        const fetchCache = new Map();
        const memoizedFetch = async (binanceQueryStr) => {
            const fullUrl = `/api/binance?${binanceQueryStr}&t=${ts}`;
            if (fetchCache.has(fullUrl)) return fetchCache.get(fullUrl);
            await new Promise(res => setTimeout(res, Math.random() * 1500));
            const promise = fetchWithTimeout(fullUrl, 15000);
            fetchCache.set(fullUrl, promise);
            return promise;
        };

        const fetchTasks = [];
        for (const targetSymbol of currentDynamicPool) {
          for (const targetInterval of POOL_INTERVALS) {
             if (['1h', '4h', '1d'].includes(targetInterval) && !POOL_SYMBOLS.includes(targetSymbol)) {
                 continue; 
             }
             fetchTasks.push({ symbol: targetSymbol, interval: targetInterval });
          }
        }

        const SYMBOL_CHUNK_SIZE = 6; 
        const results = [];

        for (let i = 0; i < fetchTasks.length; i += SYMBOL_CHUNK_SIZE) {
          if (systemHealthRef.current && systemHealthRef.current.weight > 1800) {
              await new Promise(resolve => setTimeout(resolve, 3000));
          }

          const taskChunk = fetchTasks.slice(i, i + SYMBOL_CHUNK_SIZE);
          const chunkPromises = [];
          
          for (const task of taskChunk) {
            let mtfInterval = '1h';
            if (task.interval === '15m') mtfInterval = '1h';
            else if (task.interval === '1h') mtfInterval = '4h';
            else if (task.interval === '4h') mtfInterval = '1d';
            else if (task.interval === '1d') mtfInterval = '1w';

            let macroInterval = task.interval;
            if (task.interval === '1w') macroInterval = '1d';

            const taskPromise = Promise.all([
              memoizedFetch(`path=/fapi/v1/klines&symbol=${task.symbol}&interval=${task.interval}&limit=250`),
              memoizedFetch(`path=/futures/data/takerlongshortRatio&symbol=${task.symbol}&period=${macroInterval}&limit=1`),
              memoizedFetch(`path=/futures/data/globalLongShortAccountRatio&symbol=${task.symbol}&period=${macroInterval}&limit=1`),
              memoizedFetch(`path=/fapi/v1/klines&symbol=${task.symbol}&interval=${mtfInterval}&limit=250`),
              memoizedFetch(`path=/fapi/v1/klines&symbol=${task.symbol}&interval=1d&limit=250`)
            ]).then(([klines, takerData, lsData, klinesMTF, klinesHTF]) => ({
              symbol: task.symbol,
              interval: task.interval,
              klines,
              klinesMTF, 
              klinesHTF,
              localTakerRatio: (Array.isArray(takerData) && takerData.length > 0) ? parseFloat(takerData[takerData.length-1].buySellRatio) : 1.0,
              localLsRatio: (Array.isArray(lsData) && lsData.length > 0) ? parseFloat(lsData[lsData.length-1].longShortRatio) : 1.0
            }));

            chunkPromises.push(taskPromise);
          }

          const chunkResults = await Promise.allSettled(chunkPromises);
          results.push(...chunkResults);
        }

        for (const result of results) {
          if (result.status !== 'fulfilled' || !Array.isArray(result.value.klines) || result.value.klines.length < 50) continue;
          
          try {
            // Giải phóng UI Thread (Tránh giật lag trình duyệt)
            await new Promise(resolve => setTimeout(resolve, 5));
            
            const { symbol: targetSymbol, interval: targetInterval, klines, klinesMTF, klinesHTF, localTakerRatio, localLsRatio } = result.value;

            let closesMTF = [];
            if (Array.isArray(klinesMTF) && klinesMTF.length >= 50) {
               closesMTF = klinesMTF.map(d => parseFloat(d[4]));
            } else {
               closesMTF = klines.map(d => parseFloat(d[4])); 
            }

            const highs = klines.map(d => parseFloat(d[2]));
            const lows = klines.map(d => parseFloat(d[3]));
            const closes = klines.map(d => parseFloat(d[4]));
            const quoteVolumes = klines.map(d => parseFloat(d[7])); 
            const price = closes[closes.length - 1];

            const avgVolume20 = QuantMath.sma(quoteVolumes.slice(0, -1), 20);
            const closedVolume = quoteVolumes[quoteVolumes.length - 2];

            const atr14 = QuantMath.atr(highs, lows, closes, 14);
            const rsi = QuantMath.rsi(closes, 14);
            const cmf = QuantMath.cmf(highs, lows, closes, quoteVolumes, 20); 
            
            const bbwHist = [];
            for (let i = 20; i < closes.length; i++) {
                const bb = QuantMath.bollinger(closes.slice(0, i+1), 20, 2.0);
                bbwHist.push(bb.bbw);
            }
            const bollinger20 = QuantMath.bollinger(closes, 20, 2.0);
            const bbwRank = QuantMath.percentileRank(bollinger20.bbw, bbwHist.slice(-100)); 
            const bbwSlopeLocal = bbwHist.length >= 5 ? ((bollinger20.bbw - bbwHist[bbwHist.length - 5]) / (bbwHist[bbwHist.length - 5] || 1)) * 100 : 0;
            
            const atrHistLocal = [];
            for (let i = 14; i < closes.length; i++) {
                atrHistLocal.push(QuantMath.atr(highs.slice(0, i+1), lows.slice(0, i+1), closes.slice(0, i+1), 14));
            }
            const atrRankLocal = QuantMath.percentileRank(atr14, atrHistLocal.slice(-100));

            const scan20_50 = QuantMath.scanEmaRange(closesMTF, 20, 50, 20);
            const adxValue = QuantMath.adx(highs, lows, closes, 14); 
            
            let l1 = "Range";
            const slopeBull = scan20_50.fastSlope > 0.05 && scan20_50.slowSlope > 0.02;
            const slopeBear = scan20_50.fastSlope < -0.05 && scan20_50.slowSlope < -0.02;
            if (adxValue > 25 && scan20_50.fastEmaCurrent > scan20_50.slowEmaCurrent && slopeBull) l1 = "Trend Up";
            else if (adxValue > 25 && scan20_50.fastEmaCurrent < scan20_50.slowEmaCurrent && slopeBear) l1 = "Trend Down";
            else if (adxValue > 25) l1 = "Transition"; 
            else l1 = "Range";

            let l2 = "Normal";
            const volScoreLocal = (atrRankLocal + bbwRank) / 2;
            if (volScoreLocal < 20) l2 = "Compression";
            else if (volScoreLocal > 85) l2 = "Extreme";
            else if (volScoreLocal > 65) l2 = "Expansion";
            else l2 = "Normal";

            let dir = l1.includes('Trend Up') ? 'LONG' : 'SHORT'; 
            let execType = 'LIMIT';
            if (l1 === 'Range' || l2 === 'Extreme') {
                if (rsi < 45) { dir = "LONG"; }
                else if (rsi > 55) { dir = "SHORT"; }
                else { dir = cmf > 0 ? "LONG" : "SHORT"; }
                execType = 'MARKET'; 
            }

            let cRegime = 1.0; let tHold = 3;
            if (l1.includes('Trend')) { cRegime = 1.2; tHold = 9; }
            else if (l2 === 'Extreme') { cRegime = 0.5; tHold = 1; }
            else { cRegime = 0.8; tHold = 2; }

            const localObi = realtimeMetrics[targetSymbol]?.obi !== undefined ? realtimeMetrics[targetSymbol].obi : 0.5;
            
            const localSfpLong = QuantMath.detectSFP_Advanced(highs, lows, closes, quoteVolumes, avgVolume20, 'LONG');
            const localSfpShort = QuantMath.detectSFP_Advanced(highs, lows, closes, quoteVolumes, avgVolume20, 'SHORT');

            const { tpMult, slMult, strategyName } = QuantMath.dynamicAsymmetricTargets(
                bbwRank, bbwSlopeLocal, (dir === 'LONG' ? localSfpLong : localSfpShort), 
                (atr14/price)*100, localObi, dir
            );

            let suggestedEntry = price;
            if (!(l1 === 'Range' || l2 === 'Extreme')) {
                suggestedEntry = dir === 'LONG' ? price - (0.5 * atr14) : price + (0.5 * atr14);
            }
            const entry = suggestedEntry;
            const sl = dir === 'LONG' ? entry - (slMult * atr14) : entry + (slMult * atr14);
            const tp1 = dir === 'LONG' ? entry + (tpMult * atr14) : entry - (tpMult * atr14);

            const riskDiffTech = Math.abs(entry - sl);
            const realSpread = realtimeMetrics[targetSymbol]?.spread || 0.05;
            const realFunding = realtimeMetrics[targetSymbol]?.funding || 0.0002;
            
            const activeMakerFee = tradeFeesRef.current.maker;
            const activeTakerFee = tradeFeesRef.current.taker;
            
            const costDragLoss = QuantMath.costDrag(entry, 'FUTURES', dir, execType, 'MARKET', realFunding, realSpread, tHold, activeMakerFee, activeTakerFee, targetInterval, localObi);
            const costDragWin = QuantMath.costDrag(entry, 'FUTURES', dir, execType, 'LIMIT', realFunding, realSpread, tHold, activeMakerFee, activeTakerFee, targetInterval, localObi);
            const rewardDiff = Math.abs(tp1 - entry);
            
            let simulatedRR = riskDiffTech > 0 ? ((rewardDiff - costDragWin) / (riskDiffTech + costDragLoss)) : 0;
            if (isNaN(simulatedRR) || !isFinite(simulatedRR) || simulatedRR < 0) simulatedRR = 0;

            const scan50_200 = QuantMath.scanEmaRange(closesMTF, 50, 200, 20);

            const closesHTF = Array.isArray(klinesHTF) && klinesHTF.length >= 50 ? klinesHTF.map(d => parseFloat(d[4])) : closesMTF;
            const htfSma200 = QuantMath.sma(closesHTF, 200);

            const obvArrayLocal = [];
            let currentObvLocal = 0;
            for (let j = 1; j < closes.length; j++) {
                if (closes[j] > closes[j-1]) currentObvLocal += quoteVolumes[j];
                else if (closes[j] < closes[j-1]) currentObvLocal -= quoteVolumes[j];
                obvArrayLocal.push(currentObvLocal);
            }
            const obvEma20Local = QuantMath.ema(obvArrayLocal, 20);
            
            const isObvBearDivergenceLocal = (price > htfSma200) && (obvArrayLocal[obvArrayLocal.length-1] < obvEma20Local);
            const isObvBullDivergenceLocal = (price < htfSma200) && (obvArrayLocal[obvArrayLocal.length-1] > obvEma20Local);

            const currentMvrv = mvrvZScoreRef.current || 0.23;
            const globalBtcDomValue = autoDataRef.current?.btcDomValue || 55.0;
            const globalBtcDomSlope = autoDataRef.current?.btcDomSlope || 0;
            const isAltcoinBleedingLocal = targetSymbol !== 'BTCUSDT' && globalBtcDomValue > 50 && globalBtcDomSlope > 0.5;

            // =========================================================================
            // BẢN VÁ LỖI CHIMERA DATA: KHỞI TẠO OBJECT DỮ LIỆU TINH KHIẾT (LOCAL)
            // =========================================================================
            const localAutoData = {
                currentPrice: price,
                atr14: atr14,
                atrPercent: price > 0 ? (atr14 / price) * 100 : 0,
                atrRank: atrRankLocal,
                bbw: bollinger20.bbw,
                bbwRank: bbwRank,
                bbwSlope: bbwSlopeLocal,
                adx: adxValue,
                rsi: rsi,
                cmf: cmf,
                obi: localObi,
                fundingRate: realFunding,
                fundingSlope: 0, 
                currentOi: 0, oiEma: 0, oiDelta: 0, isOiSpiking: false, 
                lastClosedVolume: closedVolume,
                avgVolume20: avgVolume20,
                isObvBearDivergence: isObvBearDivergenceLocal,
                isObvBullDivergence: isObvBullDivergenceLocal,
                isBullishSFP: localSfpLong,
                isBearishSFP: localSfpShort,
                htfSma200: htfSma200,
                ema20: { slope: scan20_50.fastSlope, value: scan20_50.fastEmaCurrent },
                ema50: { slope: scan20_50.slowSlope, value: scan20_50.slowEmaCurrent },
                ema200: { slope: scan50_200.slowSlope, value: scan50_200.slowEmaCurrent },
                btcDomValue: globalBtcDomValue,
                btcDomSlope: globalBtcDomSlope
            };

            const localApiMacro = {
                fgiValue: apiMacroRef.current?.fgiValue || 50,
                tradingSession: apiMacroRef.current?.tradingSession || 'ASIAN',
                sessionMultiplier: apiMacroRef.current?.sessionMultiplier || 1.0,
                isWeekend: apiMacroRef.current?.isWeekend || false,
                realSpreadPct: realSpread,
                longShortRatio: localLsRatio,
                takerBuySellRatio: localTakerRatio,
                lsPositionVolRatio: 1.0 
            };

            const mockVectorDetails = { 
                l1, l2, l3, l4, l5, l6, 
                isAltcoinBleeding: isAltcoinBleedingLocal, 
                isAltcoinSeason: false 
            };

            // CHUẨN HÓA LOGIC RỦI RO & MIN NOTIONAL CHO SCANNER
            const currentMinNotional = currentMinNotionalsRef.current?.[targetSymbol] || 5.0;
            const capitalSafe = liveCapitalRef.current > 0 ? liveCapitalRef.current : 100.0; 
            
            // Tính System Score Nháp (Draft) để quyết định Risk Multiplier
            const draftSystemScore = TradeValidator.evaluateScore(
                localAutoData, localApiMacro, mockVectorDetails, dir, currentMvrv, targetSymbol
            );
            
            const riskMultiplier = Math.max(0.5, Math.min(2.0, (draftSystemScore.score - 5) / 3));
            const appliedRiskPercent = 1.0 * riskMultiplier; 
            let riskAmountUSD = capitalSafe * (appliedRiskPercent / 100); 

            // Tính Safety Buffer và Tỷ lệ SL %
            const isCompressedLocal = l2 === 'Compression' || bbwRank < 20;
            const effectiveAtrPercentLocal = isCompressedLocal ? Math.max(localAutoData.atrPercent, 0.5) * 1.5 : localAutoData.atrPercent;
            const slippageBuffer = entry * (effectiveAtrPercentLocal / 100) * cRegime * localApiMacro.sessionMultiplier; 
            const sizeSlDistance = riskDiffTech + slippageBuffer;

            let slPercentForSize = sizeSlDistance / entry;
            if (!isFinite(slPercentForSize) || isNaN(slPercentForSize) || slPercentForSize === 0) slPercentForSize = 0.01;

            let positionSizeUSD = riskAmountUSD / slPercentForSize;
            let hasMinNotionalErrorLocal = false;
            
            // LOGIC CHUẨN: Chỉ Block lệnh nêú Sàn ép size Min Notional đẩy rủi ro thực tế > 2.5% Vốn
            if (positionSizeUSD > 0 && positionSizeUSD < currentMinNotional) {
                positionSizeUSD = currentMinNotional; 
                const forcedRiskUSD = positionSizeUSD * slPercentForSize;
                if (forcedRiskUSD > capitalSafe * 0.025) {
                    hasMinNotionalErrorLocal = true;
                }
            }

            const mockMathCore = {
                theoreticalRR: simulatedRR.toFixed(2),
                hasMinNotionalError: hasMinNotionalErrorLocal, 
                liqEstimate: { liqPrice: 0, maxLevForTier: 50 }, 
                leverageExceedsExchangeCap: false,
                liqSafetyMargin: 2.0
            };

            // GỌI TRỌNG TÀI BẰNG OBJECT DỮ LIỆU ĐÃ LÀM SẠCH
            const localSystemScore = TradeValidator.evaluateScore(
                localAutoData, localApiMacro, mockVectorDetails, dir, currentMvrv, targetSymbol
            );

            const localGates = TradeValidator.evaluateGates(
                localAutoData, localApiMacro, mockVectorDetails, mockMathCore, 
                dir, 'FUTURES', entry, sl, localSystemScore, tradeLogs, targetSymbol
            );

            // NẾU TRỌNG TÀI BÁO "BLOCK" (isApproved = false) -> BỎ QUA COIN NÀY NGAY LẬP TỨC
            if (!localGates.isApproved) continue;

            // Xử lý Override Tag
            let suggestedLeverage = Math.max(1, Math.ceil(positionSizeUSD / (capitalSafe * 0.9)));
            let overrideTag = strategyName !== "TIÊU CHUẨN (ADAPTIVE)" ? strategyName : '';
            if (overrideTag === '') {
                if (localGates.isNanoOverride) overrideTag = '🦠 NANO-CAP';
                else if (localGates.isSniperOverride) overrideTag = '🎯 SNIPER';
                else if (localGates.isHighRROverride) overrideTag = '🚀 ASYM-RR';
                else if (localGates.isGoldenOverride) overrideTag = '⚡ GOLDEN';
            }

            scanResultsPool.push({
              symbol: targetSymbol,
              interval: targetInterval,
              direction: dir,
              entry: parseFloat(entry.toFixed(4)),
              slTech: parseFloat(sl.toFixed(4)),
              tp1: parseFloat(tp1.toFixed(4)),
              theoreticalRR: simulatedRR.toFixed(2), 
              positionSizeUSD: positionSizeUSD.toFixed(2),
              suggestedLeverage,
              rsi: rsi.toFixed(1),
              cmf: cmf.toFixed(2),
              overrideTag 
            });
          } catch (innerErr) { 
              continue; 
          }
        }

        scanResultsPool.sort((a, b) => parseFloat(b.theoreticalRR) - parseFloat(a.theoreticalRR));
        
        if (isMounted) {
          if (scanResultsPool.length === 0) {
            setScannedTopSetups([{ isEmpty: true }]);
          } else {
            setScannedTopSetups(scanResultsPool.slice(0, 10)); 
          }
        }
      } catch (err) {
        console.error("Scanner Hard Crash:", err);
        if (isMounted) setScannedTopSetups([{ isEmpty: true, isError: true, msg: "Vercel Timeout hoặc Lỗi kết nối" }]);
      } finally {
        if (isMounted) setIsScanningBackground(false);
      }
    };

    runCrossAssetScan();
    const scanTimer = setInterval(runCrossAssetScan, 30000); 
    return () => { isMounted = false; clearInterval(scanTimer); };
  }, []); 

  useEffect(() => {
    if (!sonarEnabled || scannedTopSetups.length === 0 || scannedTopSetups[0]?.isEmpty) {
        prevScannedSigRef.current = '';
        return;
    }
    const currentSig = scannedTopSetups.map(s => `${s.symbol}-${s.interval}-${s.direction}`).join('|');
    if (prevScannedSigRef.current !== '' && currentSig !== prevScannedSigRef.current) {
        try {
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.volume = 0.6;
            audio.play().catch(e => console.log("Trình duyệt chặn Auto-play:", e));
            if (showToast) showToast("🎯 RADAR PING: Phát hiện biến động Setup mới trên Scanner!");
        } catch (error) {}
    }
    prevScannedSigRef.current = currentSig;
  }, [scannedTopSetups, sonarEnabled, showToast]);

  return { scannedTopSetups, isScanningBackground, sonarEnabled, setSonarEnabled };
}
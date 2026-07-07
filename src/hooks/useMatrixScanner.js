import { useState, useEffect, useRef } from 'react';
import QuantMath from '../core/QuantMath';
import { POOL_SYMBOLS, POOL_INTERVALS, getMinNotional } from '../config/constants';

export default function useMatrixScanner({ liveCapital, autoData, mvrvZScore, tradeFees, apiMacro, showToast }) {
  const [scannedTopSetups, setScannedTopSetups] = useState([]);
  const [isScanningBackground, setIsScanningBackground] = useState(false);
  const [sonarEnabled, setSonarEnabled] = useState(false);
  
  const prevScannedSigRef = useRef('');

  // Đưa các refs vào bên trong Hook để App.jsx không cần bận tâm nữa
  const liveCapitalRef = useRef(liveCapital);
  const autoDataRef = useRef(autoData);
  const mvrvZScoreRef = useRef(mvrvZScore);
  const tradeFeesRef = useRef(tradeFees);
  const apiMacroRef = useRef(apiMacro);

  useEffect(() => { liveCapitalRef.current = liveCapital; }, [liveCapital]);
  useEffect(() => { autoDataRef.current = autoData; }, [autoData]);
  useEffect(() => { mvrvZScoreRef.current = mvrvZScore; }, [mvrvZScore]);
  useEffect(() => { tradeFeesRef.current = tradeFees; }, [tradeFees]);
  useEffect(() => { apiMacroRef.current = apiMacro; }, [apiMacro]);

  // Động cơ Scanner chính
  useEffect(() => {
    let isMounted = true;

    const fetchWithTimeout = async (url, ms = 8000) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), ms);
        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(id);
            return response.ok ? await response.json() : [];
        } catch (error) {
            clearTimeout(id);
            return []; 
        }
    };

    const runCrossAssetScan = async () => {
      if (isScanningBackground) return;
      setIsScanningBackground(true);
      
      try {
        const ts = Date.now();
        const scanResultsPool = [];
        const realtimeMetrics = {};
        
        try {
            const [allBook, allPrem] = await Promise.all([
                fetchWithTimeout(`/api/binance?path=/api/v3/ticker/bookTicker&t=${ts}`, 10000),
                fetchWithTimeout(`/api/binance?path=/fapi/v1/premiumIndex&t=${ts}`, 10000)
            ]);

            POOL_SYMBOLS.forEach(sym => {
                const book = Array.isArray(allBook) ? allBook.find(b => b.symbol === sym) : null;
                const prem = Array.isArray(allPrem) ? allPrem.find(p => p.symbol === sym) : null;
                
                if (book && prem) {
                    const ask = parseFloat(book.askPrice);
                    const bid = parseFloat(book.bidPrice);
                    realtimeMetrics[sym] = {
                        spread: bid > 0 ? ((ask - bid) / bid) * 100 : 0.05,
                        funding: parseFloat(prem.lastFundingRate || 0)
                    };
                } else {
                    const defaultSpread = sym.includes('BTC') ? 0.01 : (sym.includes('ETH') || sym.includes('SOL') ? 0.02 : 0.05);
                    const defaultFunding = sym.includes('BTC') || sym.includes('ETH') ? 0.0001 : 0.0002;
                    realtimeMetrics[sym] = { spread: defaultSpread, funding: defaultFunding };
                }
            });
        } catch (e) {
            POOL_SYMBOLS.forEach(sym => { realtimeMetrics[sym] = { spread: 0.05, funding: 0.0002 }; });
        }

        const fetchTasks = [];
        for (const targetSymbol of POOL_SYMBOLS) {
          for (const targetInterval of POOL_INTERVALS) {
            fetchTasks.push({ symbol: targetSymbol, interval: targetInterval });
          }
        }

        const chunkSize = 9; 
        const results = [];

        for (let i = 0; i < fetchTasks.length; i += chunkSize) {
          const chunk = fetchTasks.slice(i, i + chunkSize);
          
          const chunkPromises = chunk.map(task => {
            let mtfInterval = '1h';
            if (task.interval === '15m') mtfInterval = '1h';
            else if (task.interval === '1h') mtfInterval = '4h';
            else if (task.interval === '4h') mtfInterval = '1d';
            else if (task.interval === '1d') mtfInterval = '1w';

            return Promise.all([
              fetchWithTimeout(`/api/binance?path=/api/v3/klines&symbol=${task.symbol}&interval=${task.interval}&limit=250&t=${ts}`),
              fetchWithTimeout(`/api/binance?path=/futures/data/takerlongshortRatio&symbol=${task.symbol}&period=${task.interval}&limit=1&t=${ts}`),
              fetchWithTimeout(`/api/binance?path=/futures/data/globalLongShortAccountRatio&symbol=${task.symbol}&period=${task.interval}&limit=1&t=${ts}`),
              fetchWithTimeout(`/api/binance?path=/api/v3/klines&symbol=${task.symbol}&interval=${mtfInterval}&limit=250&t=${ts}`)
            ]).then(([klines, takerData, lsData, klinesMTF]) => ({
              ...task,
              klines,
              klinesMTF, 
              localTakerRatio: (Array.isArray(takerData) && takerData.length > 0) ? parseFloat(takerData[takerData.length-1].buySellRatio) : 1.0,
              localLsRatio: (Array.isArray(lsData) && lsData.length > 0) ? parseFloat(lsData[lsData.length-1].longShortRatio) : 1.0
            }))
          });

          const chunkResults = await Promise.allSettled(chunkPromises);
          results.push(...chunkResults);
          
          if (i + chunkSize < fetchTasks.length) {
            await new Promise(resolve => setTimeout(resolve, 300)); 
          }
        }

        for (const result of results) {
          if (result.status !== 'fulfilled' || !Array.isArray(result.value.klines) || result.value.klines.length < 50) continue;
          
          try {
            const { symbol: targetSymbol, interval: targetInterval, klines, klinesMTF, localTakerRatio, localLsRatio } = result.value;

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

            const closedVolume = quoteVolumes[quoteVolumes.length - 2];
            const avgVolume20 = QuantMath.sma(quoteVolumes.slice(0, -1), 20);

            let dir = l1.includes('Trend Up') ? 'LONG' : 'SHORT'; 
            let tpMult = 2.0; 

            if (l1 === 'Range' || l2 === 'Extreme') {
                if (rsi < 45) { dir = "LONG"; }
                else if (rsi > 55) { dir = "SHORT"; }
                else { dir = cmf > 0 ? "LONG" : "SHORT"; tpMult = 1.5; }
            }

            let suggestedEntry = price;
            if (!(l1 === 'Range' || l2 === 'Extreme')) {
                suggestedEntry = dir === 'LONG' ? price - (0.5 * atr14) : price + (0.5 * atr14);
            }
            const entry = suggestedEntry;
            const sl = dir === 'LONG' ? entry - (1.5 * atr14) : entry + (1.5 * atr14);
            const tp1 = dir === 'LONG' ? entry + (tpMult * atr14) : entry - (tpMult * atr14);

            const riskDiffTech = Math.abs(entry - sl);
            
            let cRegime = 1.0; let tHold = 3;
            if (l1.includes('Trend')) { cRegime = 1.2; tHold = 9; }
            else if (l2 === 'Extreme') { cRegime = 0.5; tHold = 1; }
            else { cRegime = 0.8; tHold = 2; }
            
            const minSafeAtrScanner = 0.005;
            const isCompressedScanner = l2 === 'Compression' || bbwRank < 20;
            const currentAtrPercent = entry > 0 ? (atr14 / entry) * 100 : 0;
            const effectiveAtrPercentLocal = isCompressedScanner ? Math.max(currentAtrPercent, minSafeAtrScanner * 100) * 1.5 : currentAtrPercent;
            
            const currentMultiplier = apiMacroRef.current.sessionMultiplier || 1.0;
            const slippageBuffer = entry * (effectiveAtrPercentLocal / 100) * cRegime * currentMultiplier; 
            const dynamicSlDistance = riskDiffTech + slippageBuffer; 
            
            const realSpread = realtimeMetrics[targetSymbol].spread;
            const realFunding = realtimeMetrics[targetSymbol].funding;
            
            const activeMakerFee = tradeFeesRef.current.maker;
            const activeTakerFee = tradeFeesRef.current.taker;
            
            const costDragLoss = QuantMath.costDrag(entry, 'FUTURES', dir, 'LIMIT', 'MARKET', realFunding, realSpread, tHold, activeMakerFee, activeTakerFee, targetInterval);
            const costDragWin = QuantMath.costDrag(entry, 'FUTURES', dir, 'LIMIT', 'LIMIT', realFunding, realSpread, tHold, activeMakerFee, activeTakerFee, targetInterval);
            const rewardDiff = Math.abs(tp1 - entry);
            
            let simulatedRR = riskDiffTech > 0 ? ((rewardDiff - costDragWin) / (riskDiffTech + costDragLoss)) : 0;
            if (isNaN(simulatedRR) || !isFinite(simulatedRR) || simulatedRR < 0) simulatedRR = 0;

            const localSfpLong = QuantMath.detectSFP_Advanced(highs, lows, closes, 'LONG');
            const localSfpShort = QuantMath.detectSFP_Advanced(highs, lows, closes, 'SHORT');
            const scan50_200 = QuantMath.scanEmaRange(closesMTF, 50, 200, 20);

            const obvArrayLocal = [];
            let currentObvLocal = 0;
            for (let j = 1; j < closes.length; j++) {
                if (closes[j] > closes[j-1]) currentObvLocal += quoteVolumes[j];
                else if (closes[j] < closes[j-1]) currentObvLocal -= quoteVolumes[j];
                obvArrayLocal.push(currentObvLocal);
            }
            const obvEma20Local = QuantMath.ema(obvArrayLocal, 20);
            const isObvBearDivergenceLocal = (price > scan50_200.slowEmaCurrent) && (obvArrayLocal[obvArrayLocal.length-1] < obvEma20Local);
            const isObvBullDivergenceLocal = (price < scan50_200.slowEmaCurrent) && (obvArrayLocal[obvArrayLocal.length-1] > obvEma20Local);

            let w = { s1: 2.0, s2: 1.5, s3: 1.5, s4: 1.0, s5: 1.0, s6: 1.5, s7: 1.0, s8: 1.5 }; 
            if (l1 === 'Range') { w = { s1: 0, s2: 1.5, s3: 4.0, s4: 2.0, s5: 1.5, s6: 1.0, s7: 1.0, s8: 1.0 }; } 
            else if (l2 === 'Extreme') { w = { s1: 0, s2: 1.0, s3: 3.5, s4: 2.5, s5: 1.5, s6: 2.0, s7: 1.5, s8: 0.5 }; } 
            else if (l1.includes('Trend') && l2 === 'Expansion') { w = { s1: 3.0, s2: 2.5, s3: 0, s4: 1.0, s5: 1.0, s6: 2.5, s7: 1.0, s8: 2.0 }; }

            const checkS1 = dir === (l1.includes('Trend Up') ? 'LONG' : 'SHORT');
            const checkS2 = dir === 'LONG' ? cmf > 0.05 : cmf < -0.05;
            const checkS3 = dir === 'LONG' ? localSfpLong : localSfpShort;
            const checkS4 = dir === 'LONG' ? (l1.includes('Trend') ? rsi < 65 : rsi < 40) : (l1.includes('Trend') ? rsi > 35 : rsi > 60); 
            const checkS5 = dir === 'LONG' ? localLsRatio < 1.0 : localLsRatio > 1.0; 
            
            const localVolSpike = closedVolume > (avgVolume20 * 2.5);
            const checkS6 = dir === 'LONG' ? (localTakerRatio > 1.05 && !isObvBearDivergenceLocal) : (localTakerRatio < 0.95 && !isObvBullDivergenceLocal);
            const checkS7 = dir === 'LONG' ? (realFunding < 0 && localVolSpike) : (realFunding > 0 && localVolSpike); 
            const checkS8 = dir === 'LONG' ? (price > scan50_200.slowEmaCurrent && scan50_200.slowSlope > 0) : (price < scan50_200.slowEmaCurrent && scan50_200.slowSlope < 0); 

            let embeddedScore = 0;
            if (checkS1) embeddedScore += w.s1;
            if (checkS2) embeddedScore += w.s2;
            if (checkS3) embeddedScore += w.s3;
            if (checkS4) embeddedScore += w.s4;
            if (checkS5) embeddedScore += w.s5;
            if (checkS6) embeddedScore += w.s6;
            if (checkS7) embeddedScore += w.s7;
            if (checkS8) embeddedScore += w.s8;
            
            if (l2 === 'Compression' && checkS2 && checkS6) embeddedScore += 2.0;
            if (l2 === 'Extreme' && checkS3 && checkS4) embeddedScore += 2.0;
            if (localVolSpike && !checkS5 && checkS6) embeddedScore += 1.5;

            const isTripleTrendBull = scan20_50.fastSlope > 0 && scan20_50.slowSlope > 0 && scan50_200.slowSlope > 0;
            const isTripleTrendBear = scan20_50.fastSlope < 0 && scan20_50.slowSlope < 0 && scan50_200.slowSlope < 0;
            
            if ((dir === 'LONG' && isTripleTrendBull) || (dir === 'SHORT' && isTripleTrendBear)) embeddedScore += 1.5;
            if (adxValue > 35 && checkS6) embeddedScore += 1.5;
            
            const currentMvrv = mvrvZScoreRef?.current || 0.23;
            const btcDomSlope = autoDataRef?.current?.btcDomSlope || 0;
            const btcDomValue = autoDataRef?.current?.btcDomValue || 55.0;
            
            if ((dir === 'LONG' && currentMvrv < 1.0 && checkS3) || (dir === 'SHORT' && currentMvrv > 2.5 && checkS3)) embeddedScore += 1.5;
            if (dir === 'LONG' && targetSymbol !== 'BTCUSDT' && btcDomSlope < -0.5) embeddedScore += 1.0; 

            const isAltcoinBleedingLocal = targetSymbol !== 'BTCUSDT' && btcDomValue > 50 && btcDomSlope > 0.5;
            if (dir === 'LONG' && isAltcoinBleedingLocal) embeddedScore -= 2.0;
            if (dir === 'LONG' && currentMvrv >= 1.0) embeddedScore -= 1.5;
            if (dir === 'SHORT' && currentMvrv <= 0.8) embeddedScore -= 1.5;

            const requiredRR = bbwRank > 80 ? 1.5 : 1.2;
            const isRRSafe = simulatedRR >= requiredRR;
            const isRegimeSafe = l1 !== 'Transition' && l2 !== 'Compression';
            const isVolSafe = closedVolume >= (avgVolume20 * 0.4);
            const isSLSafe = riskDiffTech > (atr14 * 0.5);

            const isSafeFromKnife = dir === 'LONG' ? (cmf > 0.15 && rsi > 35) : (cmf < -0.15 && rsi < 65);
            const hasSynergy = (l2 === 'Compression' && checkS2 && checkS6) || 
                               (l2 === 'Extreme' && checkS3 && checkS4) || 
                               (localVolSpike && !checkS5 && checkS6) || 
                               (dir === 'LONG' && targetSymbol !== 'BTCUSDT' && btcDomSlope < -0.5) || 
                               isTripleTrendBull || isTripleTrendBear || 
                               (adxValue > 35 && checkS6) || 
                               (dir === 'LONG' && currentMvrv < 1.0 && checkS3) || 
                               (dir === 'SHORT' && currentMvrv > 2.5 && checkS3);

            const isGoldenOverride = !isRegimeSafe && isRRSafe && isVolSafe && isSLSafe && (embeddedScore >= 8.5) && hasSynergy && isSafeFromKnife;
            const isSniperOverride = !isSLSafe && isRegimeSafe && isRRSafe && isVolSafe && checkS3 && embeddedScore >= 7.0;
            const isHighRROverride = !isVolSafe && isSLSafe && isRegimeSafe && isRRSafe && simulatedRR >= 2.5 && embeddedScore >= 7.0;

            const finalRegimeCheck = isRegimeSafe || isGoldenOverride;
            const finalVolCheck = isVolSafe || isHighRROverride;
            const finalSLCheck = isSLSafe || isSniperOverride;

            const isApproved = (isRRSafe && finalRegimeCheck && finalVolCheck && finalSLCheck);
            
            if (!isApproved || embeddedScore < 6.5) continue; 

            const currentMinNotional = getMinNotional(targetSymbol);
            const capitalSafe = liveCapitalRef.current > 0 ? liveCapitalRef.current : 106.0; 
            const riskAmountUSD = capitalSafe * 0.01; 
            const slPercentForSize = dynamicSlDistance / entry; 
            let positionSizeUSD = riskAmountUSD / slPercentForSize;
            
            if (positionSizeUSD < currentMinNotional) positionSizeUSD = currentMinNotional; 

            const actualRiskUSD = positionSizeUSD * slPercentForSize;
            const maxSurvivalRiskUSD = capitalSafe * 0.05; 
            if (actualRiskUSD > maxSurvivalRiskUSD) continue;

            let suggestedLeverage = Math.max(1, Math.ceil(positionSizeUSD / (capitalSafe * 0.9)));

            let overrideTag = '';
            if (isSniperOverride) overrideTag = '🎯 SNIPER';
            else if (isHighRROverride) overrideTag = '🚀 ASYM-RR';
            else if (isGoldenOverride) overrideTag = '⚡ GOLDEN';

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
    const scanTimer = setInterval(runCrossAssetScan, 40000); 
    return () => { isMounted = false; clearInterval(scanTimer); };
  }, []); // Dependency array rỗng hoàn toàn an toàn nhờ Refs

  // Động cơ Sonar Ping
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
        } catch (error) {
            console.error("Lỗi phát âm thanh:", error);
        }
    }
    
    prevScannedSigRef.current = currentSig;
  }, [scannedTopSetups, sonarEnabled, showToast]);

  return {
    scannedTopSetups,
    isScanningBackground,
    sonarEnabled,
    setSonarEnabled
  };
}
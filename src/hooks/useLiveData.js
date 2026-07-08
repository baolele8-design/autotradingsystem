// FILE: src/hooks/useLiveData.js
import { useState, useEffect, useRef } from 'react';
import QuantMath from '../core/QuantMath';

export default function useLiveData({ symbol, intervalTime, indicatorSpecs, setSystemHealth }) {
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [systemError, setSystemError] = useState(false);

  const [liveCapital, setLiveCapital] = useState(0);
  const [binancePositions, setBinancePositions] = useState([]);
  const [leverageBrackets, setLeverageBrackets] = useState(null);
  const [tradeFees, setTradeFees] = useState({ maker: 0.0002, taker: 0.0004 });

  const [autoData, setAutoData] = useState(null);
  const [cmcData, setCmcData] = useState({
    btcDominanceRealtime: 55.0,
    totalMarketCapBillion: 0,
    fgiClassification: 'NEUTRAL'
  });

  const [apiMacro, setApiMacro] = useState({
    fgiValue: 50,
    longShortRatio: 1.0,
    lsPositionVolRatio: 1.0, 
    takerBuySellRatio: 1.0, 
    tradingSession: 'ASIAN', 
    sessionMultiplier: 0.8,
    isWeekend: false,
    realSpreadPct: 0.05 
  });

  const apiMacroRef = useRef(apiMacro);
  useEffect(() => { apiMacroRef.current = apiMacro; }, [apiMacro]);

  useEffect(() => {
    const detectSessionAndWeekend = () => {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const day = now.getUTCDay();
      
      let currentSession = 'ASIAN';
      let mult = 0.8; 
      
      if (utcHour >= 8 && utcHour < 13) { currentSession = 'LONDON'; mult = 1.2; }
      if (utcHour >= 13 && utcHour < 21) { currentSession = 'NEW_YORK'; mult = 1.5; }
      
      const isWknd = (day === 0 || day === 6);
      if (isWknd) mult = mult * 0.5;
      
      setApiMacro(prev => ({ 
        ...prev, isWeekend: isWknd, tradingSession: currentSession, sessionMultiplier: mult
      }));
    };
    detectSessionAndWeekend();
    const timer = setInterval(detectSessionAndWeekend, 60000); 
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const fetchBracketsAndFees = async () => {
      try {
        const ts = Date.now();
        const resBracket = await fetch(`/api/binance?path=/fapi/v1/leverageBracket&symbol=${symbol}&isPrivate=true&t=${ts}`);
        if (resBracket.ok) {
           const data = await resBracket.json();
           if (isMounted && Array.isArray(data) && data[0]?.brackets) setLeverageBrackets(data[0].brackets);
        }
        const resFee = await fetch(`/api/binance?path=/fapi/v1/commissionRate&symbol=${symbol}&isPrivate=true&t=${ts}`);
        if (resFee.ok) {
           const data = await resFee.json();
           if (isMounted && data && data.makerCommissionRate) {
              setTradeFees({ maker: parseFloat(data.makerCommissionRate), taker: parseFloat(data.takerCommissionRate) });
           }
        }
      } catch (err) {}
    };
    fetchBracketsAndFees();
    return () => { isMounted = false; };
  }, [symbol]);

  useEffect(() => {
    let isMounted = true;
    const fetchCMC = async () => {
      try {
        const res = await fetch('/api/cmc');
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted) {
          setCmcData({ btcDominanceRealtime: data.btcDominance, totalMarketCapBillion: data.totalMarketCap / 1e9, fgiClassification: data.fgiClassification });
          setApiMacro(prev => ({ ...prev, fgiValue: data.fgiValue }));
        }
      } catch (err) {}
    };
    fetchCMC();
    const timer = setInterval(fetchCMC, 300000); 
    return () => { isMounted = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      try {
        setSystemError(false); 
        let mtfInterval = '1h';
        if (intervalTime === '15m') mtfInterval = '1h';
        else if (intervalTime === '1h') mtfInterval = '4h';
        else if (intervalTime === '4h') mtfInterval = '1d';
        else if (intervalTime === '1d') mtfInterval = '1w';

        let macroInterval = intervalTime;
        if (intervalTime === '1w') macroInterval = '1d'; 

        const ts = Math.floor(Date.now() / 15000) * 15000;
        
        const safeFetch = async (url) => {
          try {
            const startPing = Date.now();
            const res = await fetch(url, { signal: controller.signal });
            const latency = Date.now() - startPing;
            
            const weight = res.headers.get('x-mbx-used-weight-1m');
            if (weight && setSystemHealth && isMounted) {
               setSystemHealth(prev => ({ ...prev, weight: parseInt(weight, 10), latency }));
            }

            if (!res.ok) return null;
            return await res.json();
          } catch (e) { return null; }
        };

        const requests = [
          safeFetch(`/api/binance?path=/fapi/v1/klines&symbol=${symbol}&interval=${intervalTime}&limit=250&t=${ts}`),
          safeFetch(`/api/binance?path=/fapi/v1/klines&symbol=${symbol}&interval=${mtfInterval}&limit=250&t=${ts}`),
          safeFetch(`/api/binance?path=/fapi/v1/klines&symbol=${symbol}&interval=1d&limit=250&t=${ts}`),
          safeFetch(`/api/binance?path=/fapi/v1/fundingRate&symbol=${symbol}&limit=10&t=${ts}`),
          safeFetch(`/api/binance?path=/fapi/v1/openInterest&symbol=${symbol}&t=${ts}`),
          safeFetch(`/api/binance?path=/futures/data/openInterestHist&symbol=${symbol}&period=${macroInterval}&limit=30&t=${ts}`),
          safeFetch(`/api/binance?path=/futures/data/globalLongShortAccountRatio&symbol=${symbol}&period=${macroInterval}&limit=1&t=${ts}`),
          safeFetch(`/api/binance?path=/futures/data/topLongShortPositionRatio&symbol=${symbol}&period=${macroInterval}&limit=1&t=${ts}`),
          safeFetch(`/api/binance?path=/futures/data/takerlongshortRatio&symbol=${symbol}&period=${macroInterval}&limit=1&t=${ts}`),
          safeFetch(`/api/binance?path=/fapi/v2/positionRisk&isPrivate=true&t=${ts}`),
          safeFetch(`/api/binance?path=/fapi/v2/account&isPrivate=true&t=${ts}`),
          safeFetch(`/api/binance?path=/fapi/v1/klines&symbol=BTCDOMUSDT&interval=${mtfInterval}&limit=25&t=${ts}`),
          safeFetch(`/api/binance?path=/fapi/v1/ticker/bookTicker&symbol=${symbol}&t=${ts}`),
          safeFetch(`/api/binance?path=/fapi/v1/premiumIndex&symbol=${symbol}&t=${ts}`)
        ];

        const results = await Promise.allSettled(requests);
        const [
          klinesLTF, klinesMTF, klinesHTF, fundingHist, 
          oiCurrent, oiHist, lsAccData, lsPosData, takerData, 
          positionsRisk, accountInfo, btcDomKlines, realBookTicker, realPremiumIndex
        ] = results.map(res => res.status === 'fulfilled' ? res.value : null);

        if (!klinesLTF || !klinesHTF || !klinesMTF) throw new Error("Core Klines API Blocked.");
        
        if (accountInfo && accountInfo.availableBalance) {
           setLiveCapital(parseFloat(accountInfo.availableBalance)); 
        }
        if (!isMounted) return;

        const highsLTF = klinesLTF.map(d => parseFloat(d[2]));
        const lowsLTF = klinesLTF.map(d => parseFloat(d[3]));
        const closesLTF = klinesLTF.map(d => parseFloat(d[4]));
        const volumesLTF = klinesLTF.map(d => parseFloat(d[7])); 
        const currentPrice = closesLTF[closesLTF.length - 1] || 0;
        
        const closesHTF = klinesHTF.map(d => parseFloat(d[4]));
        const htfSma200 = QuantMath.sma(closesHTF, 200);

        let fetchedSpread = apiMacroRef.current.realSpreadPct;
        let fetchedObi = 0.5;
        if (realBookTicker && realBookTicker.bidPrice && realBookTicker.askPrice) {
            const bid = parseFloat(realBookTicker.bidPrice);
            const ask = parseFloat(realBookTicker.askPrice);
            const bidQty = parseFloat(realBookTicker.bidQty || 0);
            const askQty = parseFloat(realBookTicker.askQty || 0);
            
            if (bid > 0) fetchedSpread = ((ask - bid) / bid) * 100;
            if (bidQty + askQty > 0) fetchedObi = bidQty / (bidQty + askQty);
        }

        let fetchedLsAcc = 1.0, fetchedLsPos = 1.0, fetchedTaker = 1.0;
        if (lsAccData && lsAccData.length > 0) fetchedLsAcc = parseFloat(lsAccData[lsAccData.length-1].longShortRatio);
        if (lsPosData && lsPosData.length > 0) fetchedLsPos = parseFloat(lsPosData[lsPosData.length-1].longShortRatio);
        if (takerData && takerData.length > 0) fetchedTaker = parseFloat(takerData[takerData.length-1].buySellRatio);

        const avgVolume20 = QuantMath.sma(volumesLTF.slice(0, -1), 20);

        setApiMacro(prev => ({ ...prev, realSpreadPct: fetchedSpread, longShortRatio: fetchedLsAcc, lsPositionVolRatio: fetchedLsPos, takerBuySellRatio: fetchedTaker }));

        const oiValues = Array.isArray(oiHist) ? oiHist.map(d => parseFloat(d.sumOpenInterestValue) || 0) : [0];
        const oiEma14 = QuantMath.ema(oiValues, 14) || oiValues[oiValues.length - 1] || 0;
        const currentOiValue = oiCurrent ? (parseFloat(oiCurrent.openInterest) * currentPrice) : 0;
        
        let oiDeltaPercent = 0;
        if (oiValues.length >= 2) {
           const prevOi = oiValues[oiValues.length - 2];
           const currOi = oiValues[oiValues.length - 1];
           if (prevOi > 0) oiDeltaPercent = ((currOi - prevOi) / prevOi) * 100;
        }

        const fundingRateValue = realPremiumIndex ? parseFloat(realPremiumIndex.lastFundingRate) * 100 : 0;
        let fundingSlopeValue = 0;
        if (fundingHist && fundingHist.length >= 3) {
           fundingSlopeValue = (parseFloat(fundingHist[fundingHist.length - 1].fundingRate) - parseFloat(fundingHist[fundingHist.length - 3].fundingRate)) * 100;
        }

        const atr14 = QuantMath.atr(highsLTF, lowsLTF, closesLTF, 14);
        const adxValue = QuantMath.adx(highsLTF, lowsLTF, closesLTF, 14);
        const rsiValue = QuantMath.rsi(closesLTF, indicatorSpecs.rsiPeriod);
        
        const bbwHist = [];
        for (let i = indicatorSpecs.bbPeriod; i < closesLTF.length; i++) {
            const bb = QuantMath.bollinger(closesLTF.slice(0, i+1), indicatorSpecs.bbPeriod, indicatorSpecs.bbStdDev);
            bbwHist.push(bb.bbw);
        }
        const bollinger20 = QuantMath.bollinger(closesLTF, indicatorSpecs.bbPeriod, indicatorSpecs.bbStdDev);
        const bbwRank = QuantMath.percentileRank(bollinger20.bbw, bbwHist.slice(-100)); 
        const bbwSlopeValue = bbwHist.length >= 5 ? ((bollinger20.bbw - bbwHist[bbwHist.length - 5]) / (bbwHist[bbwHist.length - 5] || 1)) * 100 : 0;

        const cmfValue = QuantMath.cmf(highsLTF, lowsLTF, closesLTF, volumesLTF, 20);

        let btcDomSlope = 0;
        let btcDomValue = cmcData.btcDominanceRealtime || 55.0; 
        if (btcDomKlines && Array.isArray(btcDomKlines) && btcDomKlines.length >= 2) {
             const domCloses = btcDomKlines.map(d => parseFloat(d[4]));
             btcDomValue = domCloses[domCloses.length - 1]; 
             const pastDom = domCloses[0];
             btcDomSlope = ((btcDomValue - pastDom) / pastDom) * 100;
        }

        const closesMTF = klinesMTF.map(d => parseFloat(d[4]));
        const scan20_50 = QuantMath.scanEmaRange(closesMTF, 20, 50, 20);
        const scan50_200 = QuantMath.scanEmaRange(closesMTF, 50, 200, 20);

        const atrHist = [];
        for (let i = 14; i < closesLTF.length; i++) {
            atrHist.push(QuantMath.atr(highsLTF.slice(0, i+1), lowsLTF.slice(0, i+1), closesLTF.slice(0, i+1), 14));
        }
        const atrRank = QuantMath.percentileRank(atr14, atrHist.slice(-100)); 

        const obvArray = [];
        let currentObv = 0;
        for (let i = 1; i < closesLTF.length; i++) {
            if (closesLTF[i] > closesLTF[i-1]) currentObv += volumesLTF[i];
            else if (closesLTF[i] < closesLTF[i-1]) currentObv -= volumesLTF[i];
            obvArray.push(currentObv);
        }
        const obvEma20 = QuantMath.ema(obvArray, 20);
        const isObvBearDivergence = (currentPrice > htfSma200) && (obvArray[obvArray.length-1] < obvEma20);
        const isObvBullDivergence = (currentPrice < htfSma200) && (obvArray[obvArray.length-1] > obvEma20);

        // VÁ LỖI ĐỒNG BỘ: Chuyền parameter chính xác cho detectSFP_Advanced
        setAutoData({
            currentPrice, atr14, atrPercent: currentPrice > 0 ? (atr14 / currentPrice) * 100 : 0, atrRank,
            adx: adxValue, htfSma200, rsi: rsiValue, bbwRank, bbw: bollinger20.bbw, cmf: cmfValue,
            ema20: { value: scan20_50.fastEmaCurrent, slope: scan20_50.fastSlope }, 
            ema34: { value: QuantMath.ema(closesMTF, 34), slope: 0 }, 
            ema50: { value: scan20_50.slowEmaCurrent, slope: scan20_50.slowSlope }, 
            ema89: { value: QuantMath.ema(closesMTF, 89), slope: 0 }, 
            ema200: { value: scan50_200.slowEmaCurrent, slope: scan50_200.slowSlope },
            scan20_50, scan50_200, 
            fundingRate: fundingRateValue, fundingSlope: fundingSlopeValue, 
            obi: fetchedObi, bbwSlope: bbwSlopeValue,
            currentOi: currentOiValue, oiEma: oiEma14, oiDelta: oiDeltaPercent, isOiSpiking: currentOiValue > oiEma14,
            currentVolume: volumesLTF[volumesLTF.length - 1], lastClosedVolume: volumesLTF[volumesLTF.length - 2], 
            avgVolume20: avgVolume20, 
            isObvBearDivergence, isObvBullDivergence,
            isBullishSFP: QuantMath.detectSFP_Advanced(highsLTF, lowsLTF, closesLTF, volumesLTF, avgVolume20, 'LONG'),
            isBearishSFP: QuantMath.detectSFP_Advanced(highsLTF, lowsLTF, closesLTF, volumesLTF, avgVolume20, 'SHORT'),
            btcDomValue, btcDomSlope
        });

        if (positionsRisk && Array.isArray(positionsRisk)) {
          const activePositions = positionsRisk.filter(p => parseFloat(p.positionAmt) !== 0);
          setBinancePositions(activePositions);
        }
        
        setLastUpdated(new Date());
      } catch (error) { 
        setSystemError(true); 
      } finally { 
        if (isMounted) setLoading(false); 
      }
    };

    fetchData();
    const timer = setInterval(fetchData, 15000); 
    return () => { isMounted = false; controller.abort(); clearInterval(timer); };
  }, [symbol, intervalTime, indicatorSpecs, cmcData.btcDominanceRealtime]);

  return { loading, lastUpdated, systemError, liveCapital, binancePositions, leverageBrackets, tradeFees, autoData, cmcData, apiMacro };
}
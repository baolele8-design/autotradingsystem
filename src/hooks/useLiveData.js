// FILE: src/hooks/useLiveData.js
import { useState, useEffect, useRef, useCallback } from 'react';
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
  const [cmcData, setCmcData] = useState({ btcDominanceRealtime: 55.0, totalMarketCapBillion: 0, fgiClassification: 'NEUTRAL' });
  
  const [apiMacro, setApiMacro] = useState({
    fgiValue: 50, longShortRatio: 1.0, lsPositionVolRatio: 1.0, takerBuySellRatio: 1.0,
    tradingSession: 'ASIAN', sessionMultiplier: 0.8, isWeekend: false, realSpreadPct: 0.05
  });

  // Bộ đệm (Buffer) RAM tốc độ cao & Cờ trạng thái (isDirty)
  const isDirty = useRef(false);
  const dataBuffer = useRef({
      ltf: [], mtf: [], htf: [], 
      obi: 0.5, spread: 0.05, currentOiValue: 0, oiEma: 0, oiDelta: 0,
      fundingRate: 0, fundingSlope: 0, btcDomValue: 55.0, btcDomSlope: 0
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
      
      setApiMacro(prev => ({ ...prev, isWeekend: isWknd, tradingSession: currentSession, sessionMultiplier: mult }));
    };
    detectSessionAndWeekend();
    const timer = setInterval(detectSessionAndWeekend, 60000); 
    return () => clearInterval(timer);
  }, []);

  // LUỒNG 1: REST HYDRATION (Chỉ chạy 1 lần để mồi mảng 250 nến vào RAM)
  useEffect(() => {
    let isMounted = true;
    const initData = async () => {
      setLoading(true);
      try {
        let mtfInterval = '1h';
        if (intervalTime === '15m') mtfInterval = '1h';
        else if (intervalTime === '1h') mtfInterval = '4h';
        else if (intervalTime === '4h') mtfInterval = '1d';
        else if (intervalTime === '1d') mtfInterval = '1w';

        const ts = Date.now();
        const [resLtf, resMtf, resHtf] = await Promise.all([
            fetch(`/api/binance?path=/fapi/v1/klines&symbol=${symbol}&interval=${intervalTime}&limit=250&t=${ts}`),
            fetch(`/api/binance?path=/fapi/v1/klines&symbol=${symbol}&interval=${mtfInterval}&limit=250&t=${ts}`),
            fetch(`/api/binance?path=/fapi/v1/klines&symbol=${symbol}&interval=1d&limit=250&t=${ts}`)
        ]);

        if (resLtf.ok && resMtf.ok && resHtf.ok) {
            dataBuffer.current.ltf = await resLtf.json();
            dataBuffer.current.mtf = await resMtf.json();
            dataBuffer.current.htf = await resHtf.json();
            isDirty.current = true;
            if (isMounted) setLoading(false);
        }
      } catch (e) {
        if (isMounted) setSystemError(true);
      }
    };
    initData();
    return () => { isMounted = false; };
  }, [symbol, intervalTime]);

  // HÀM BÓP CÒ: TÁI TÍNH TOÁN LÕI LƯỢNG TỬ
  const recalculateCoreEngine = useCallback(() => {
    const buffer = dataBuffer.current;
    if (!buffer.ltf.length || !buffer.mtf.length || !buffer.htf.length) return;

    const highsLTF = buffer.ltf.map(d => parseFloat(d[2]));
    const lowsLTF = buffer.ltf.map(d => parseFloat(d[3]));
    const closesLTF = buffer.ltf.map(d => parseFloat(d[4]));
    const volumesLTF = buffer.ltf.map(d => parseFloat(d[7])); 
    const currentPrice = closesLTF[closesLTF.length - 1] || 0;
    
    const closesMTF = buffer.mtf.map(d => parseFloat(d[4]));
    const closesHTF = buffer.htf.map(d => parseFloat(d[4]));
    const htfSma200 = QuantMath.sma(closesHTF, 200);

    const avgVolume20 = QuantMath.sma(volumesLTF.slice(0, -1), 20);

    const atr14 = QuantMath.atr(highsLTF, lowsLTF, closesLTF, 14);
    const adxValue = QuantMath.adx(highsLTF, lowsLTF, closesLTF, 14);
    const rsiValue = QuantMath.rsi(closesLTF, indicatorSpecs.rsiPeriod);
    const cmfValue = QuantMath.cmf(highsLTF, lowsLTF, closesLTF, volumesLTF, 20);

    const bollinger20 = QuantMath.bollinger(closesLTF, indicatorSpecs.bbPeriod, indicatorSpecs.bbStdDev);
    
    const bbwHist = [];
    for (let i = indicatorSpecs.bbPeriod; i < closesLTF.length; i++) {
        const bb = QuantMath.bollinger(closesLTF.slice(0, i+1), indicatorSpecs.bbPeriod, indicatorSpecs.bbStdDev);
        bbwHist.push(bb.bbw);
    }
    const bbwRank = QuantMath.percentileRank(bollinger20.bbw, bbwHist.slice(-100)); 
    const bbwSlopeValue = bbwHist.length >= 5 ? ((bollinger20.bbw - bbwHist[bbwHist.length - 5]) / (bbwHist[bbwHist.length - 5] || 1)) * 100 : 0;

    const atrHist = [];
    for (let i = 14; i < closesLTF.length; i++) {
        atrHist.push(QuantMath.atr(highsLTF.slice(0, i+1), lowsLTF.slice(0, i+1), closesLTF.slice(0, i+1), 14));
    }
    const atrRank = QuantMath.percentileRank(atr14, atrHist.slice(-100));

    const scan20_50 = QuantMath.scanEmaRange(closesMTF, 20, 50, 20);
    const scan50_200 = QuantMath.scanEmaRange(closesMTF, 50, 200, 20);

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

    setAutoData({
        currentPrice, atr14, atrPercent: currentPrice > 0 ? (atr14 / currentPrice) * 100 : 0, atrRank,
        adx: adxValue, htfSma200, rsi: rsiValue, bbwRank, bbw: bollinger20.bbw, cmf: cmfValue,
        ema20: { value: scan20_50.fastEmaCurrent, slope: scan20_50.fastSlope },
        ema34: { value: QuantMath.ema(closesMTF, 34), slope: 0 },
        ema50: { value: scan20_50.slowEmaCurrent, slope: scan20_50.slowSlope },
        ema89: { value: QuantMath.ema(closesMTF, 89), slope: 0 },
        ema200: { value: scan50_200.slowEmaCurrent, slope: scan50_200.slowSlope },
        scan20_50, scan50_200,
        fundingRate: buffer.fundingRate, fundingSlope: buffer.fundingSlope,
        obi: buffer.obi, bbwSlope: bbwSlopeValue,
        currentOi: buffer.currentOiValue, oiEma: buffer.oiEma, oiDelta: buffer.oiDelta, isOiSpiking: buffer.currentOiValue > buffer.oiEma,
        currentVolume: volumesLTF[volumesLTF.length - 1], lastClosedVolume: volumesLTF[volumesLTF.length - 2],
        avgVolume20: avgVolume20,
        isObvBearDivergence, isObvBullDivergence,
        isBullishSFP: QuantMath.detectSFP_Advanced(highsLTF, lowsLTF, closesLTF, volumesLTF, avgVolume20, 'LONG'),
        isBearishSFP: QuantMath.detectSFP_Advanced(highsLTF, lowsLTF, closesLTF, volumesLTF, avgVolume20, 'SHORT'),
        btcDomValue: buffer.btcDomValue, btcDomSlope: buffer.btcDomSlope
    });
    
    setLastUpdated(new Date());
  }, [indicatorSpecs]);

  // LUỒNG 2: KẾT NỐI WEBSOCKET CHUẨN MỚI
  useEffect(() => {
    if (loading) return; 
    
    const sym = symbol.toLowerCase();
    let mtfInterval = '1h';
    if (intervalTime === '15m') mtfInterval = '1h';
    else if (intervalTime === '1h') mtfInterval = '4h';
    else if (intervalTime === '4h') mtfInterval = '1d';
    else if (intervalTime === '1d') mtfInterval = '1w';
    
    const marketUrl = `wss://fstream.binance.com/market/stream?streams=${sym}@kline_${intervalTime}/${sym}@kline_${mtfInterval}/${sym}@kline_1d/${sym}@markPrice`;
    const publicUrl = `wss://fstream.binance.com/public/stream?streams=${sym}@bookTicker`;

    const wsMarket = new WebSocket(marketUrl);
    const wsPublic = new WebSocket(publicUrl);

    wsMarket.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (!payload.data) return;
        
        const stream = payload.stream;
        const data = payload.data;

        if (stream.includes('@kline')) {
            const k = data.k;
            const candle = [ k.t, k.o, k.h, k.l, k.c, k.v, k.T, k.q ]; 
            
            let targetBuffer = null;
            if (stream.includes(intervalTime)) targetBuffer = dataBuffer.current.ltf;
            else if (stream.includes(mtfInterval)) targetBuffer = dataBuffer.current.mtf;
            else if (stream.includes('1d')) targetBuffer = dataBuffer.current.htf;

            if (targetBuffer && targetBuffer.length > 0) {
                const lastIdx = targetBuffer.length - 1;
                if (targetBuffer[lastIdx][0] === candle[0]) {
                    targetBuffer[lastIdx] = candle;
                } else if (candle[0] > targetBuffer[lastIdx][0]) {
                    targetBuffer.push(candle);
                    if (targetBuffer.length > 250) targetBuffer.shift(); 
                }
                isDirty.current = true;
            }
        } 
        else if (stream.includes('@markPrice')) {
            dataBuffer.current.fundingRate = parseFloat(data.r || 0) * 100;
            isDirty.current = true;
        }
    };

    wsPublic.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.data && payload.stream.includes('@bookTicker')) {
            const b = parseFloat(payload.data.b);
            const a = parseFloat(payload.data.a);
            const bQ = parseFloat(payload.data.B);
            const aQ = parseFloat(payload.data.A);
            
            if (b > 0) {
              dataBuffer.current.spread = ((a - b) / b) * 100;
              setApiMacro(prev => ({ ...prev, realSpreadPct: dataBuffer.current.spread }));
            }
            if (bQ + aQ > 0) dataBuffer.current.obi = bQ / (bQ + aQ);
            isDirty.current = true;
        }
    };

    return () => { wsMarket.close(); wsPublic.close(); };
  }, [symbol, intervalTime, loading]);

  // ENGINE THROTTLER: CỨU CÁNH CỦA TRÌNH DUYỆT (Giới hạn Render ở mức 2 FPS)
  useEffect(() => {
    if (loading) return;
    const tickRate = setInterval(() => {
        if (isDirty.current) {
            recalculateCoreEngine();
            isDirty.current = false;
        }
    }, 500); // 500ms hãm tốc
    return () => clearInterval(tickRate);
  }, [loading, recalculateCoreEngine]);

  // LUỒNG 3: MACRO & USER DATA POLLING (Ép chạy chậm mỗi 30 giây để bắt vĩ mô)
  useEffect(() => {
    let isMounted = true;
    const fetchSlowMacro = async () => {
        if (loading) return;
        try {
            let macroInterval = intervalTime;
            if (intervalTime === '1w') macroInterval = '1d';
            let mtfInterval = '1h';
            if (intervalTime === '15m') mtfInterval = '1h';
            else if (intervalTime === '1h') mtfInterval = '4h';
            else if (intervalTime === '4h') mtfInterval = '1d';
            else if (intervalTime === '1d') mtfInterval = '1w';

            const ts = Date.now();
            const res = await Promise.allSettled([
                fetch(`/api/binance?path=/fapi/v1/openInterest&symbol=${symbol}&t=${ts}`),
                fetch(`/api/binance?path=/futures/data/openInterestHist&symbol=${symbol}&period=${macroInterval}&limit=30&t=${ts}`),
                fetch(`/api/binance?path=/futures/data/globalLongShortAccountRatio&symbol=${symbol}&period=${macroInterval}&limit=1&t=${ts}`),
                fetch(`/api/binance?path=/futures/data/topLongShortPositionRatio&symbol=${symbol}&period=${macroInterval}&limit=1&t=${ts}`),
                fetch(`/api/binance?path=/futures/data/takerlongshortRatio&symbol=${symbol}&period=${macroInterval}&limit=1&t=${ts}`),
                fetch(`/api/binance?path=/fapi/v1/klines&symbol=BTCDOMUSDT&interval=${mtfInterval}&limit=25&t=${ts}`),
                fetch(`/api/binance?path=/fapi/v2/account&isPrivate=true&t=${ts}`),
                fetch(`/api/binance?path=/fapi/v2/positionRisk&isPrivate=true&t=${ts}`),
                fetch(`/api/binance?path=/fapi/v1/fundingRate&symbol=${symbol}&limit=10&t=${ts}`)
            ]);

            const [oiCur, oiHist, lsAcc, lsPos, taker, btcDom, acc, pos, fundHist] = res.map(r => r.status === 'fulfilled' && r.value && r.value.ok ? r.value.json() : Promise.resolve(null));
            const [oiCurD, oiHistD, lsAccD, lsPosD, takerD, btcDomD, accD, posD, fundHistD] = await Promise.all([oiCur, oiHist, lsAcc, lsPos, taker, btcDom, acc, pos, fundHist]);

            if (!isMounted) return;

            if (accD && accD.availableBalance) setLiveCapital(parseFloat(accD.availableBalance));
            if (posD && Array.isArray(posD)) setBinancePositions(posD.filter(p => parseFloat(p.positionAmt) !== 0));

            let fetchedLsAcc = 1.0, fetchedLsPos = 1.0, fetchedTaker = 1.0;
            if (lsAccD && lsAccD.length > 0) fetchedLsAcc = parseFloat(lsAccD[lsAccD.length-1].longShortRatio);
            if (lsPosD && lsPosD.length > 0) fetchedLsPos = parseFloat(lsPosD[lsPosD.length-1].longShortRatio);
            if (takerD && takerD.length > 0) fetchedTaker = parseFloat(takerD[takerD.length-1].buySellRatio);
            
            setApiMacro(prev => ({ ...prev, longShortRatio: fetchedLsAcc, lsPositionVolRatio: fetchedLsPos, takerBuySellRatio: fetchedTaker }));

            const price = dataBuffer.current.ltf.length > 0 ? parseFloat(dataBuffer.current.ltf[dataBuffer.current.ltf.length - 1][4]) : 0;
            
            if (oiCurD) dataBuffer.current.currentOiValue = parseFloat(oiCurD.openInterest) * price;
            if (oiHistD && Array.isArray(oiHistD)) {
                const oiValues = oiHistD.map(d => parseFloat(d.sumOpenInterestValue) || 0);
                dataBuffer.current.oiEma = QuantMath.ema(oiValues, 14) || oiValues[oiValues.length - 1] || 0;
                if (oiValues.length >= 2) {
                    const prevOi = oiValues[oiValues.length - 2];
                    const currOi = oiValues[oiValues.length - 1];
                    dataBuffer.current.oiDelta = prevOi > 0 ? ((currOi - prevOi) / prevOi) * 100 : 0;
                }
            }

            if (btcDomD && Array.isArray(btcDomD) && btcDomD.length >= 2) {
                const domCloses = btcDomD.map(d => parseFloat(d[4]));
                dataBuffer.current.btcDomValue = domCloses[domCloses.length - 1]; 
                const pastDom = domCloses[0];
                dataBuffer.current.btcDomSlope = pastDom > 0 ? ((dataBuffer.current.btcDomValue - pastDom) / pastDom) * 100 : 0;
            }

            if (fundHistD && Array.isArray(fundHistD) && fundHistD.length >= 3) {
                dataBuffer.current.fundingSlope = (parseFloat(fundHistD[fundHistD.length - 1].fundingRate) - parseFloat(fundHistD[fundHistD.length - 3].fundingRate)) * 100;
            }
            
            isDirty.current = true;
        } catch (e) {}
    };
    
    fetchSlowMacro();
    const macroTimer = setInterval(fetchSlowMacro, 30000); 
    return () => { isMounted = false; clearInterval(macroTimer); };
  }, [symbol, intervalTime, loading]);

  // NẠP ĐÒN BẨY & PHÍ
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

  // NẠP CMC VĨ MÔ
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

  return { loading, lastUpdated, systemError, liveCapital, binancePositions, leverageBrackets, tradeFees, autoData, cmcData, apiMacro };
}
// FILE: src/hooks/useLiveData.js
import { useState, useEffect } from 'react';
import { fetchLatestModel } from '../../../shared/ledgerClient.js';

export default function useLiveData({
  symbol,
  intervalTime,
  indicatorSpecs,
  setMvrvZScore,
  setSystemHealth
}) {
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [systemError, setSystemError] = useState(false);

  const [liveCapital, setLiveCapital] = useState(0);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [binancePositions, setBinancePositions] = useState([]);
  const [leverageBrackets, setLeverageBrackets] = useState(null);
  const [tradeFees, setTradeFees] = useState({ maker: 0.0002, taker: 0.0004 });
  const [autoData, setAutoData] = useState(null);
  const [apiMacro, setApiMacro] = useState({ fgiValue: 50, longShortRatio: 1.0, lsPositionVolRatio: 1.0, takerBuySellRatio: 1.0, tradingSession: 'ASIAN', sessionMultiplier: 0.8, isWeekend: false, realSpreadPct: 0.05 });
  const [cmcData, setCmcData] = useState({ btcDominanceRealtime: 55.0, totalMarketCapBillion: 0, fgiClassification: 'NEUTRAL' });
  
  // STATE MỚI: CHỨA NÃO BỘ TỐI ƯU
  const [aiModel, setAiModel] = useState(null);

  // KÉO MODEL TỪ DAEMON QUA LEDGER BRIDGE (Chạy 1 lần khi load app)
  useEffect(() => {
    const loadModel = async () => {
        try {
            const { data, error } = await fetchLatestModel();
            if (!error && data) {
                setAiModel(data);
            }
        } catch (e) {
            console.warn('[AI MODEL] Không lấy được model qua bridge:', e.message);
        }
    };
    loadModel();
  }, []);

  // LUỒNG 1: NHẬN STREAM DỮ LIỆU ĐÃ TÍNH TOÁN SẴN TỪ DAEMON
  useEffect(() => {
    let isMounted = true;
    let ws;
    let reconnectTimer;

    const connectTelemetry = () => {
        const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
        ws = new WebSocket(`ws://${host}:1338`);
        
        ws.onopen = () => {
            if (isMounted) {
                ws.send(JSON.stringify({ action: 'SUBSCRIBE_HUD', symbol, intervalTime, indicatorSpecs }));
                setSystemError(false);
            }
        };

        ws.onmessage = (event) => {
            if (!isMounted) return;
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'HUD_SYNC') {
                    const { autoData: ad, apiMacro: am, liveCapital: lc, availableBalance: ab, binancePositions: bp, leverageBrackets: lb, tradeFees: tf, cmcData: cmc, mvrvState, binanceRateLimit, telemetryAt } = msg.payload; 
                    
                    setAutoData(ad); setApiMacro(am); 
                    if (lc !== undefined && lc > 0) setLiveCapital(lc);
                    if (ab !== undefined && ab > 0) setAvailableBalance(ab);
                    
                    if (bp) setBinancePositions(bp); 
                    if (lb) setLeverageBrackets(lb);
                    if (tf) setTradeFees(tf);
                    if (cmc) setCmcData(cmc);
                    if (Number.isFinite(Number(mvrvState?.value))) {
                        setMvrvZScore(Number(mvrvState.value), 'daemon');
                    }
                    if (binanceRateLimit) {
                        setSystemHealth(previous => ({
                            ...previous,
                            latency: telemetryAt
                                ? Math.max(0, Date.now() - telemetryAt)
                                : previous.latency,
                            maxWeight: binanceRateLimit.requestWeightLimit || previous.maxWeight,
                            weight: binanceRateLimit.usedWeight1m || 0
                        }));
                    }
                    
                    setLastUpdated(new Date()); setLoading(false);
                } else if (msg.type === 'MARK_PRICE') {
                    const newPrice = Number(msg.payload?.price);
                    if (!Number.isFinite(newPrice) || newPrice <= 0) return;
                    setAutoData(prev => {
                        if (!prev) return prev;
                        return {
                            ...prev,
                            currentPrice: newPrice,
                            atrPercent: (prev.atr14 / newPrice) * 100
                        };
                    });
                }
            } catch (error) {
                console.warn('[HUD MESSAGE]', error.message);
            }
        };

        ws.onclose = () => {
            if (isMounted) { setSystemError(true); reconnectTimer = setTimeout(connectTelemetry, 5000); }
        };
    };

    setLoading(true);
    connectTelemetry();

    return () => {
        isMounted = false;
        clearTimeout(reconnectTimer);
        if (ws) {
            if (ws.readyState === 1) ws.close();
            else if (ws.readyState === 0) ws.onopen = () => ws.close();
        }
    };
  }, [indicatorSpecs, intervalTime, setMvrvZScore, setSystemHealth, symbol]);

  // Giá mark được daemon hợp nhất từ Binance rồi phát lại qua cùng kết nối HUD.
  // TRẢ VỀ aiModel để các module khác sử dụng
  return { loading, lastUpdated, systemError, liveCapital, availableBalance, binancePositions, leverageBrackets, tradeFees, autoData, cmcData, apiMacro, aiModel };
}

// FILE: src/App.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { BrainCircuit, Activity, Loader2, ServerCrash, Bell, Server } from 'lucide-react';

import QuantMath from './core/QuantMath';
import { supabase } from './services/supabase';

import useLiveData from './hooks/useLiveData';
import useMatrixScanner from './hooks/useMatrixScanner';
import useExchangeConfig from './hooks/useExchangeConfig';

import MatrixScanner from './components/scanner/MatrixScanner';
import LiveMetrics from './components/terminal/LiveMetrics';
import VectorState from './components/terminal/VectorState';
import OrderForm from './components/terminal/OrderForm';
import LogicGates from './components/terminal/LogicGates';
import AiAudit from './components/terminal/AiAudit';
import TradeJournal from './components/terminal/TradeJournal';
import {TradeValidator}  from './core/TradeValidator';
import useAppStore from './store/useAppStore';

export default function AntiFragileTerminal() {

  const { 
    symbol, setSymbol, 
    intervalTime, setIntervalTime, 
    mvrvZScore, setMvrvZScore,
    tradeSetup, setTradeSetup,
    systemHealth, setSystemHealth 
  } = useAppStore();

  const [toast, setToast] = useState('');

  const [indicatorSpecs, setIndicatorSpecs] = useState({ emaFast: 12, emaSlow: 26, rsiPeriod: 14, bbPeriod: 20, bbStdDev: 2.0 });



  const [tradeLogs, setTradeLogs] = useState([]);
  const [tradeStats, setTradeStats] = useState({ totalClosed: 0, winRate: 0, avgWinR: 0, avgLossR: 1, historicalRR: 0, hasEnoughData: false });

  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [geminiCooldown, setGeminiCooldown] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);


  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const { dynamicMinNotionals, dynamicPool, stepSizes, tickSizes } = useExchangeConfig();

  const {
    loading, lastUpdated, systemError, liveCapital,
    binancePositions, leverageBrackets, tradeFees,
    autoData, cmcData, apiMacro
  } = useLiveData({ symbol, intervalTime, indicatorSpecs, setSystemHealth });

  const { 
    scannedTopSetups, isScanningBackground, sonarEnabled, setSonarEnabled 
  } = useMatrixScanner({ 
    liveCapital, autoData, mvrvZScore, tradeFees, apiMacro, showToast,
    dynamicPool, dynamicMinNotionals, setSystemHealth, systemHealth
  });

  useEffect(() => {
    if (geminiCooldown > 0) { 
      const t = setTimeout(() => setGeminiCooldown(c => c - 1), 1000); 
      return () => clearTimeout(t); 
    }
  }, [geminiCooldown]);

  useEffect(() => {
    if (!supabase) return;
    const fetchLogs = async () => {
      try {
        const { data, error } = await supabase.from('trade_logs').select('*').order('created_at', { ascending: false }).limit(300);
        if (!error && data) setTradeLogs(data);
      } catch (err) { console.error(err); }
    };
    fetchLogs();
    const subscription = supabase.channel('public:trade_logs').on('postgres_changes', { event: '*', schema: 'public', table: 'trade_logs' }, (payload) => {
        if (payload.eventType === 'INSERT') setTradeLogs(current => [payload.new, ...current].slice(0, 300));
        else if (payload.eventType === 'UPDATE') setTradeLogs(current => current.map(log => log.id === payload.new.id ? payload.new : log));
        else if (payload.eventType === 'DELETE') setTradeLogs(current => current.filter(log => log.id !== payload.old.id));
      }).subscribe();
    return () => supabase.removeChannel(subscription);
  }, []);

  useEffect(() => {
    const closedTrades = tradeLogs.filter(d => ['WIN', 'LOSS', 'PARTIAL_CLOSED'].includes(d.status) && d.symbol === symbol);
    let totalWinR = 0; let winCount = 0; let totalLossR = 0; let lossCount = 0;

    closedTrades.forEach(t => {
       const rMultiple = (parseFloat(t.pnl_usd) || 0) / (parseFloat(t.risk_amount_usd) || 1);
       if (t.pnl_usd > 0) { totalWinR += rMultiple; winCount++; }
       if (t.pnl_usd <= 0 && t.status === 'LOSS') { totalLossR += Math.abs(rMultiple); lossCount++; }
    });
    setTradeStats({ 
      totalClosed: closedTrades.length, 
      winRate: closedTrades.length > 0 ? (winCount / closedTrades.length) : 0, 
      avgWinR: winCount > 0 ? (totalWinR / winCount) : 0, 
      avgLossR: lossCount > 0 ? (totalLossR / lossCount) : 1, 
      historicalRR: (lossCount > 0 ? (totalLossR / lossCount) : 1) > 0 ? ((winCount > 0 ? (totalWinR / winCount) : 0) / (lossCount > 0 ? (totalLossR / lossCount) : 1)) : 0,
      hasEnoughData: closedTrades.length >= 30 
    });
  }, [tradeLogs, symbol]);

  const vectorRegime = useMemo(() => {
    if (!autoData || !apiMacro || !cmcData) return null;

    let l1 = "Range";
    const slopeBull = autoData.ema20.slope > 0.05 && autoData.ema50.slope > 0.02;
    const slopeBear = autoData.ema20.slope < -0.05 && autoData.ema50.slope < -0.02;
    
    if (autoData.adx > 25 && autoData.ema20.value > autoData.ema50.value && slopeBull) l1 = "Trend Up";
    else if (autoData.adx > 25 && autoData.ema20.value < autoData.ema50.value && slopeBear) l1 = "Trend Down";
    else if (autoData.adx > 25) l1 = "Transition"; else l1 = "Range";

    let l2 = "Normal";
    const volScore = (autoData.atrRank + autoData.bbwRank) / 2;
    if (volScore < 20) l2 = "Compression"; else if (volScore > 85) l2 = "Extreme"; else if (volScore > 65) l2 = "Expansion"; else l2 = "Normal";

    let l3 = "Quiet";
    const isVolSpikeHUD = autoData.lastClosedVolume > (autoData.avgVolume20 * 2.5);
    const isFundingSqueezeLongs = autoData.fundingSlope > 0.05 && l1 === "Range";
    const isFundingSqueezeShorts = autoData.fundingSlope < -0.05 && l1 === "Range";
    
    if (autoData.isBullishSFP) l3 = "Sweep Low (SFP)"; else if (autoData.isBearishSFP) l3 = "Sweep High (SFP)";
    else if (isFundingSqueezeLongs) l3 = "Longs Trapped (Squeeze Imminent)"; else if (isFundingSqueezeShorts) l3 = "Shorts Trapped (Squeeze Imminent)";
    else if (isVolSpikeHUD && autoData.currentPrice > autoData.ema20.value && l2 === "Expansion") l3 = "Breakout";
    else if (isVolSpikeHUD && autoData.currentPrice < autoData.ema20.value && l2 === "Expansion") l3 = "Breakdown"; else if (isVolSpikeHUD) l3 = "Stop Hunt / Climax";

    let l4 = "Neutral";
    const priceUp = autoData.currentPrice > autoData.ema20.value;
    const oiUp = autoData.oiDelta > 1.5; const oiDown = autoData.oiDelta < -1.5;
    const smartMoneyLong = priceUp && oiUp && apiMacro.takerBuySellRatio > 1.05 && apiMacro.lsPositionVolRatio <= 1.0;
    const smartMoneyShort = !priceUp && oiUp && apiMacro.takerBuySellRatio < 0.95 && apiMacro.lsPositionVolRatio >= 1.0;

    if (smartMoneyLong) l4 = "Smart Money Long Building"; else if (smartMoneyShort) l4 = "Smart Money Short Building";
    else if (priceUp && oiUp) l4 = "Retail Long Building"; else if (priceUp && oiDown) l4 = "Short Covering";
    else if (!priceUp && oiUp) l4 = "Retail Short Building"; else if (!priceUp && oiDown) l4 = "Long Liquidation";
    if (isVolSpikeHUD && oiDown && autoData.atrRank > 90) l4 = "Capitulation / Blow-off"; 

    let l5 = "Weak";
    const isFakeBull = autoData.rsi > 60 && autoData.cmf < -0.05; 
    const isFakeBear = autoData.rsi < 40 && autoData.cmf > 0.05;  
    if (autoData.isObvBearDivergence || autoData.isObvBullDivergence) l5 = "Divergence (OBV)"; else if (isFakeBull) l5 = "Fake Momentum (Bull Trap)";
    else if (isFakeBear) l5 = "Fake Momentum (Bear Trap)"; else if (autoData.rsi > 75 || autoData.rsi < 25) l5 = "Exhaustion";
    else if ((autoData.rsi > 60 || autoData.rsi < 40) && autoData.adx > 25) l5 = "Strong"; else l5 = "Weak / Mixed";

    let l6 = "Fair Value"; let mvrvDesc = "Fair value";
    if (mvrvZScore > 3.5) { l6 = "Extreme Overvaluation"; mvrvDesc = "Bong bóng"; } else if (mvrvZScore >= 2.5) { l6 = "Moderate Overvaluation"; mvrvDesc = "Định giá cao"; }
    else if (mvrvZScore >= 1.0) { l6 = "Fair to Overvalue"; mvrvDesc = "Bình thường - Khá cao"; } else if (mvrvZScore >= 0.8) { l6 = "Fair to Undervalue"; mvrvDesc = "Bình thường - Rẻ"; }
    else { l6 = "Undervaluation"; mvrvDesc = "Vùng tích lũy"; }

    const isAltcoinBleeding = symbol !== 'BTCUSDT' && autoData.btcDomValue > 50 && autoData.btcDomSlope > 0.5;
    const isAltcoinSeason = symbol !== 'BTCUSDT' && autoData.btcDomSlope < -0.5;
    if (isAltcoinBleeding) l6 += " (Altcoin Bleeding)"; else if (isAltcoinSeason) l6 += " (Altcoin Season)";

    return { vector: [l1, l2, l3, l4, l5, l6], details: { l1, l2, l3, l4, l5, l6, mvrvDesc, isAltcoinBleeding, isAltcoinSeason } };
  }, [lastUpdated, apiMacro, cmcData, mvrvZScore, symbol]);

  const systemScore = useMemo(() => {
    if (!autoData || !apiMacro || !vectorRegime) return { score: 0, synergyText: "", penaltyText: "", checks: {}, w: {} };
    return TradeValidator.evaluateScore(autoData, apiMacro, vectorRegime.details, tradeSetup.direction, mvrvZScore, symbol);
  }, [lastUpdated, apiMacro, vectorRegime, tradeSetup.direction, mvrvZScore, symbol]);

  const mathCore = useMemo(() => {
    const safeResult = { appliedRiskPercent: 1.0, slPercent: "0.00", riskAmountUSD: "0.00", positionSizeUSD: "0.00", marginUsedUSD: "0.00", suggestedLeverage: 1, theoreticalRR: "0.00", trueEVValue: "0.00", kellyPct: 0, liqEstimate: null, liqSafetyMargin: 0, leverageExceedsExchangeCap: false, dynamicSlDistance: 0, hasMinNotionalError: false, isSizeForcedByExchange: false };
    if (!autoData || !vectorRegime || !tradeSetup.entry || tradeSetup.entry <= 0 || tradeSetup.slTech <= 0) return safeResult;
    
    const riskDiffTech = Math.abs(tradeSetup.entry - tradeSetup.slTech);
    let cRegime = 1.0; let tHold = 3;
    if (vectorRegime.details.l1.includes('Trend')) { cRegime = 1.2; tHold = 9; } else if (vectorRegime.details.l2 === 'Extreme') { cRegime = 0.5; tHold = 1; } else { cRegime = 0.8; tHold = 2; }
    
    const minSafeAtr = 0.005; const isCompressed = vectorRegime.details.l2 === 'Compression' || autoData.bbwRank < 20;
    const effectiveAtrPercent = isCompressed ? Math.max(autoData.atrPercent, minSafeAtr * 100) * 1.5 : autoData.atrPercent;
    const slippageBuffer = tradeSetup.entry * (effectiveAtrPercent / 100) * cRegime * apiMacro.sessionMultiplier; 
    const sizeSlDistance = riskDiffTech + slippageBuffer; 
    let slPercentForSize = sizeSlDistance / tradeSetup.entry;
    if (!isFinite(slPercentForSize) || isNaN(slPercentForSize) || slPercentForSize === 0) slPercentForSize = 0.01;

    const activeMakerFee = tradeFees.maker; const activeTakerFee = tradeFees.taker;
    const costDragLoss = QuantMath.costDrag(tradeSetup.entry, tradeSetup.tradeType, tradeSetup.direction, tradeSetup.execution, 'MARKET', autoData.fundingRate / 100, apiMacro.realSpreadPct, tHold, activeMakerFee, activeTakerFee, intervalTime, autoData.obi);
    const costDragWin = QuantMath.costDrag(tradeSetup.entry, tradeSetup.tradeType, tradeSetup.direction, tradeSetup.execution, 'LIMIT', autoData.fundingRate / 100, apiMacro.realSpreadPct, tHold, activeMakerFee, activeTakerFee, intervalTime, autoData.obi);
    const rewardDiff1 = Math.abs(tradeSetup.tp1 - tradeSetup.entry);
    let theoreticalRR = riskDiffTech > 0 ? ((rewardDiff1 - costDragWin) / (riskDiffTech + costDragLoss)) : 0;
    if (!isFinite(theoreticalRR) || isNaN(theoreticalRR) || theoreticalRR < 0) theoreticalRR = 0;

    const bayesianPrior = 0.45; 
    const effWinRate = tradeStats.totalClosed < 30 ? ((bayesianPrior * (30 - tradeStats.totalClosed) + (tradeStats.winRate || 0) * tradeStats.totalClosed) / 30) : tradeStats.winRate; 
    const effLossRate = 1 - effWinRate;
    const trueEVCalc = QuantMath.trueEV(effWinRate, theoreticalRR, effLossRate, 1);

    const capitalSafe = liveCapital > 0 ? liveCapital : 0; 

    const riskMultiplier = Math.max(0.5, Math.min(2.0, (systemScore.score - 5) / 3));
    let appliedRiskPercent = tradeSetup.riskPercent * riskMultiplier;

    let riskAmountUSD = capitalSafe * (appliedRiskPercent / 100);
    let positionSizeUSD = riskAmountUSD / slPercentForSize; 
    if (!isFinite(positionSizeUSD) || isNaN(positionSizeUSD)) positionSizeUSD = 0;

    // SỬA CƠ CHẾ CHẶN RISK KHI BỊ SÀN ÉP SIZE (mathCore)
      
      const targetMinThreshold = dynamicMinNotionals[symbol] || 5.0; 
      let hasMinNotionalError = false; let isSizeForcedByExchange = false;
      
      if (positionSizeUSD > 0 && positionSizeUSD < targetMinThreshold) {
          positionSizeUSD = targetMinThreshold; 
          isSizeForcedByExchange = true;
          const newRiskUSD = positionSizeUSD * slPercentForSize; 
          riskAmountUSD = newRiskUSD;
          
          // HẠ NGƯỠNG CHẶN CỨNG TỪ 5% XUỐNG 2.5% VỐN
          // Nếu sàn ép size làm risk vượt quá 2.5% vốn, khóa mẹnh lập tức.
          if (newRiskUSD > capitalSafe * 0.025) {
              hasMinNotionalError = true;
          }
      }
    let suggestedLeverage = 1; let marginUsedUSD = positionSizeUSD;
    if (tradeSetup.tradeType === 'FUTURES') {
       let minRequiredLev = positionSizeUSD / (capitalSafe * 0.9 || 1);
       suggestedLeverage = Math.max(1, Math.ceil(minRequiredLev)); marginUsedUSD = positionSizeUSD / suggestedLeverage;
    }

    let liqEstimate = null; let leverageExceedsExchangeCap = false; let liqSafetyMargin = 0;
    if (tradeSetup.tradeType === 'FUTURES' && leverageBrackets) {
       liqEstimate = QuantMath.estimateLiquidation(positionSizeUSD, suggestedLeverage, tradeSetup.entry, tradeSetup.direction, leverageBrackets);
       if (liqEstimate) {
         if (suggestedLeverage > liqEstimate.maxLevForTier) {
             leverageExceedsExchangeCap = true; suggestedLeverage = liqEstimate.maxLevForTier; marginUsedUSD = positionSizeUSD / suggestedLeverage;
             liqEstimate = QuantMath.estimateLiquidation(positionSizeUSD, suggestedLeverage, tradeSetup.entry, tradeSetup.direction, leverageBrackets);
         }
         const liqDistancePct = Math.abs(tradeSetup.entry - liqEstimate.liqPrice) / tradeSetup.entry;
         const dynamicSlPct = sizeSlDistance / tradeSetup.entry; liqSafetyMargin = dynamicSlPct > 0 ? (liqDistancePct / dynamicSlPct) : 0; 
       }
    }

    const kellyDec = QuantMath.kellyCriterion(tradeStats.winRate, tradeStats.historicalRR, tradeStats.totalClosed);
    return {
      appliedRiskPercent: appliedRiskPercent.toFixed(2),
      slPercentForSize: (slPercentForSize * 100).toFixed(2), riskAmountUSD: riskAmountUSD.toFixed(2), positionSizeUSD: positionSizeUSD.toFixed(2), marginUsedUSD: marginUsedUSD.toFixed(2),
      suggestedLeverage, theoreticalRR: theoreticalRR.toFixed(2), trueEVValue: trueEVCalc.toFixed(3), kellyPct: (kellyDec * 100).toFixed(2),
      liqEstimate, liqSafetyMargin, leverageExceedsExchangeCap, dynamicSlDistance: sizeSlDistance, hasMinNotionalError, isSizeForcedByExchange
    };
  }, [autoData, apiMacro, liveCapital, tradeSetup, symbol, tradeStats, leverageBrackets, vectorRegime, tradeFees, dynamicMinNotionals, systemScore.score, intervalTime]);

  const logicGates = useMemo(() => {
    if (!autoData || !mathCore || !vectorRegime) return { hardGates: [], softGates: [], softScore: 0, isApproved: false };
    return TradeValidator.evaluateGates(
       autoData, apiMacro, vectorRegime.details, mathCore, tradeSetup.direction, 
       tradeSetup.tradeType, tradeSetup.entry, tradeSetup.slTech, systemScore, tradeLogs, symbol
    );
  }, [lastUpdated, mathCore, tradeSetup, apiMacro, vectorRegime, symbol, systemScore, tradeLogs]);

  const runGeminiAnalysis = async () => {
    if (geminiCooldown > 0 || !autoData || !mathCore || !vectorRegime) return;
    setIsAnalyzing(true); setAiAnalysis('Đang kích hoạt Hội đồng 5 Nhà Phân tích Kỹ thuật (Gemini 3.1 Flash-Lite)...');
    
    try {
      const basePromptContext = `[ANTI-FRAGILE QUANTUM TERMINAL V5.5.0]
- TÀI SẢN: ${symbol} | KHUNG: ${intervalTime} | PHIÊN: ${apiMacro.tradingSession}
- SETUP: ${tradeSetup.tradeType} ${tradeSetup.direction} | Entry: $${tradeSetup.entry} | SL: $${tradeSetup.slTech} | TP1: $${tradeSetup.tp1}
- TOÁN HỌC RỦI RO: Size=$${mathCore.positionSizeUSD} | Tỷ lệ R:R=1:${mathCore.theoreticalRR} | True EV=${mathCore.trueEVValue}R | Kelly=${mathCore.kellyPct}%
- TRẠNG THÁI GATES: ${logicGates.isApproved ? "PASS (Cho phép)" : "BLOCK (Nguy hiểm)"} | Điểm Mềm=${logicGates.softScore}/10.0
- VECTOR L1-L6: [${vectorRegime.vector.join(', ')}]
- ĐỘNG HỌC MVRV & DOM: MVRV-Z=${mvrvZScore} | BTC Dom=${autoData.btcDomValue.toFixed(1)}%
- ĐỘNG HỌC ORDERBOOK: OBI=${(autoData.obi*100).toFixed(1)}% | Gia tốc Nén BBW=${autoData.bbwSlope.toFixed(2)}%`;

      const analysts = [
        {
          id: "Agent_1",
          role: "Nhà phân tích Xu hướng & Động học Cấu trúc (Trend & Structure)",
          focusPrompt: `Dữ liệu cấu trúc EMA (20 nến): Độ dốc EMA20=${autoData.ema20.slope.toFixed(2)}%, EMA50=${autoData.ema50.slope.toFixed(2)}%, EMA200=${autoData.ema200.slope.toFixed(2)}%. HTF SMA200=$${autoData.htfSma200.toFixed(2)}. ADX Trend Strength=${autoData.adx.toFixed(1)}. Hãy phân tích độ nén và gia tốc của xu hướng. Bắt buộc kết luận bằng 1 câu chỉ ra 'Xác suất thành công: XX%'.`
        },
        {
          id: "Agent_2",
          role: "Nhà phân tích Biến động & Ma sát Giao dịch (Volatility & Cost Drag)",
          focusPrompt: `Chỉ báo Biến động: ATR=${autoData.atr14.toFixed(2)} (Rank P${autoData.atrRank.toFixed(0)}), BBW Rank=P${autoData.bbwRank.toFixed(0)}, Gia tốc BBW=${autoData.bbwSlope.toFixed(2)}%. Dữ liệu Ma sát: Funding Rate=${autoData.fundingRate.toFixed(4)}% (Slope: ${autoData.fundingSlope.toFixed(4)}%), Real Spread=${apiMacro.realSpreadPct.toFixed(4)}%. Hãy đánh giá việc Entry/SL có đủ an toàn so với biến động (ATR) và chi phí ẩn (Cost Drag) hay không.`
        },
        {
          id: "Agent_3",
          role: "Nhà phân tích Orderflow & Dấu chân Smart Money (Orderbook Engine)",
          focusPrompt: `Dữ liệu vị thế: OI Delta=${autoData.oiDelta.toFixed(2)}% (Spiking: ${autoData.isOiSpiking}). Taker Buy/Sell=${apiMacro.takerBuySellRatio.toFixed(2)}. OBI=${(autoData.obi*100).toFixed(1)}%. Phát hiện Phân kỳ OBV: Bearish=${autoData.isObvBearDivergence}, Bullish=${autoData.isObvBullDivergence}. Hãy giải mã phe nào đang bị kẹt (Trapped Liquidity) và dự phóng cú Squeeze.`
        },
        {
          id: "Agent_4",
          role: "Nhà phân tích Động lượng & Quét Thanh khoản (Momentum & SFP)",
          focusPrompt: `Dữ liệu: RSI=${autoData.rsi.toFixed(1)}, Dòng tiền Chaikin (CMF)=${autoData.cmf.toFixed(2)}. Tín hiệu SFP (Swing Failure Pattern): Bullish SFP=${autoData.isBullishSFP}, Bearish SFP=${autoData.isBearishSFP}. Thẩm định xem cú trade này là Fakeout (Bẫy) hay một cú Breakout/Reversal chân thực.`
        },
        {
          id: "Agent_5",
          role: "Nhà quản trị Rủi ro Tồn tại (Survival Risk & Liquidation)",
          focusPrompt: `Đòn bẩy dự kiến: ${mathCore.suggestedLeverage}x. Rủi ro thực tế (Non-linear Scaled): $${mathCore.riskAmountUSD} (${mathCore.appliedRiskPercent}%). Khoảng cách Thanh lý (Safety Margin): ${mathCore.liqSafetyMargin > 0 ? (mathCore.liqSafetyMargin*100).toFixed(0)+'%' : 'N/A'}. Cảnh báo Min Notional: ${mathCore.hasMinNotionalError}. Hãy đánh giá rủi ro cháy tài khoản (Ruin Risk) nếu gặp Flash Crash.`
        }
      ];

      const subAgentPromises = analysts.map(agent => 
        fetch(`/api/gemini`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: "gemini-3.1-flash-lite", input: `${basePromptContext}\n\nVai trò: ${agent.role}\n${agent.focusPrompt}`, generation_config: { thinking_level: "low" } })
        }).then(res => res.json()).then(data => `--- BÁO CÁO: ${agent.role} ---\n${data.steps?.find(s => s.type === 'model_output')?.content?.[0]?.text || 'Lỗi.'}\n`).catch(err => `--- BÁO CÁO: ${agent.role} ---\n[CRASH] ${err.message}\n`)
      );

      const councilReports = await Promise.all(subAgentPromises);
      setAiAnalysis('Hội đồng đã đệ trình. Đang chuyển cho Giám đốc Phán quyết tối cao (Gemini 3.1 Flash-Lite)...');

      const masterPrompt = `HỆ THỐNG MASTER CONTROLLER (ANTI-FRAGILE V5.5). Vai trò: Giám đốc Rủi ro tối cao (CRO).
Dữ liệu từ 5 Đặc vụ:
${councilReports.join("\n")}

LỊCH SỬ BAYESIAN (Thói quen Trader trên cặp ${symbol}): Winrate ${(tradeStats.winRate * 100).toFixed(1)}% | R:R trung bình: ${tradeStats.historicalRR.toFixed(2)} | Tổng số lệnh đã đóng: ${tradeStats.totalClosed}

BẤT DI BẤT DỊCH:
1. Bạn phải mở đầu bằng chữ "PHÁN QUYẾT: DUYỆT" hoặc "PHÁN QUYẾT: ĐỨNG NGOÀI" (In hoa).
2. Viết ngắn gọn, súc tích (Dưới 200 chữ).
3. Nếu Winrate < 40% hoặc lệnh bị BLOCK bởi Logic Gates, hãy chỉ trích trực tiếp vào tính kỷ luật của trader.
4. Chỉ ra "Điểm Hợp Lưu (Synergy)" mạnh nhất, hoặc "Phân kỳ ngầm" độc hại nhất của setup này.`;

      const finalRes = await fetch(`/api/gemini`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "gemini-3.1-flash-lite", input: masterPrompt, generation_config: { thinking_level: "low" } })
      });

      const finalData = await finalRes.json();
      setAiAnalysis(finalData.steps?.find(step => step.type === 'model_output')?.content?.[0]?.text || 'Lỗi trích xuất phán quyết.');
      setGeminiCooldown(15); 
    } catch (error) {
      setAiAnalysis('❌ Lỗi kết nối AI Serverless.'); setGeminiCooldown(30); 
    }
    setIsAnalyzing(false);
  };

  const handleSaveTradeLog = async () => {
    if (!supabase) return;
    try {
      // 1. TẠO JSON SIÊU NHẸ: Chỉ lưu những thông số râu ria không cần Query vào Database
      const compressedAutoData = {
          currentPrice: autoData.currentPrice,
          atrPercent: autoData.atrPercent,
          atrRank: autoData.atrRank,
          bbw: autoData.bbw,
          isOiSpiking: autoData.isOiSpiking,
          isBullishSFP: autoData.isBullishSFP,
          isBearishSFP: autoData.isBearishSFP,
          btcDomValue: autoData.btcDomValue,
          ema20Slope: autoData.ema20.slope,
          ema50Slope: autoData.ema50.slope,
          ema200Slope: autoData.ema200.slope
      };

      const fullSystemContext = {
         vector_details: vectorRegime.details,
         auto_data: compressedAutoData, // Đã gọt sạch RSI, ADX, CMF, Funding... vì sẽ ném ra cột riêng
         math_core: {
            suggestedLeverage: mathCore.suggestedLeverage,
            liqEstimate: mathCore.liqEstimate,
            kellyPct: mathCore.kellyPct,
            trueEVValue: mathCore.trueEVValue
         },
         api_macro: apiMacro
      };

      // 2. PAYLOAD CẤP 1 (FLATTENED COLUMNS): Phục vụ Query Database siêu tốc
      const payload = {
        symbol, 
        interval: intervalTime, 
        type: tradeSetup.tradeType, 
        direction: tradeSetup.direction,
        entry: parseFloat(tradeSetup.entry), 
        sl: parseFloat(tradeSetup.slTech), 
        tp_1_price: parseFloat(tradeSetup.tp1), 
        tp_2_price: null, 
        risk_amount_usd: Math.max(0.1, parseFloat(mathCore.riskAmountUSD)), 
        position_size_usd: parseFloat(mathCore.positionSizeUSD), // TRƯỜNG MỚI ĐƯỢC TÁCH
        rr: parseFloat(mathCore.theoreticalRR),
        
        // --- CHỈ BÁO KỸ THUẬT RÃ PHẲNG ---
        adx: parseFloat(autoData.adx), 
        atr: parseFloat(autoData.atr14), 
        rsi: parseFloat(autoData.rsi), // TRƯỜNG MỚI ĐƯỢC TÁCH
        cmf: parseFloat(autoData.cmf), 
        bbw_rank: parseInt(autoData.bbwRank), 
        oi_delta: parseFloat(autoData.oiDelta || 0), 
        funding_rate: parseFloat(autoData.fundingRate),
        funding_slope: parseFloat(autoData.fundingSlope || 0), 
        taker_ratio: parseFloat(apiMacro.takerBuySellRatio || 1), 
        btc_dom_slope: parseFloat(autoData.btcDomSlope || 0), // TRƯỜNG MỚI ĐƯỢC TÁCH
        mvrv: parseFloat(mvrvZScore), 
        fgi: parseInt(apiMacro.fgiValue),
        // ---------------------------------

        trend_sma200: autoData.currentPrice > autoData.htfSma200 ? 'UP' : 'DOWN', 
        leverage: parseFloat(mathCore.suggestedLeverage), 
        status: 'PENDING', 
        pnl_usd: 0, 
        session: apiMacro.tradingSession, 
        market_regime: vectorRegime.vector.join(' | '), 
        ai_advice: aiAnalysis ? aiAnalysis.substring(0, 3000) : null, 
        soft_score: parseFloat(logicGates.softScore), 
        holding_cycles: 1, 
        applied_risk_pct: parseFloat(mathCore.appliedRiskPercent),
        
        meta_data: fullSystemContext // JSON Rác đã được nén tối đa
      };
      
      const { error } = await supabase.from('trade_logs').insert([payload]);
      if (error) throw error;
      showToast("☁️ ĐÃ LƯU VECTOR. Lệnh đang ở trạng thái [CHỜ KHỚP].");
    } catch (e) { showToast(`❌ Lỗi Supabase: ${e.message}`); }
  };

  // THAY THẾ HÀM syncBinanceToSupabase (Dòng ~300 trong src/App.jsx)
  const syncBinanceToSupabase = async () => {
    if (!supabase || !tradeLogs || tradeLogs.length === 0) return;
    setIsSyncing(true);
    
    try {
      showToast("🔄 Đang khởi chạy Thuật toán Đối soát Sổ cái Lượng tử (Ledger Reconciliation)...");
      
      // 1. Tách danh sách các đồng Coin (Symbols) duy nhất có trong 300 lệnh gần nhất của Sổ tay
      const uniqueSymbols = [...new Set(tradeLogs.map(log => log.symbol))];
      let updatedCount = 0;
      const ts = Date.now();

      // 2. Chạy đối soát từng Đồng Coin một (Group by Symbol)
      for (const sym of uniqueSymbols) {
          // Sắp xếp các lệnh của đồng coin này theo dòng thời gian (Cũ -> Mới)
          const symLogs = tradeLogs.filter(l => l.symbol === sym).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          
          const currentPosition = binancePositions?.find(p => p.symbol === sym);
          const positionAmt = currentPosition ? parseFloat(currentPosition.positionAmt) : 0;

          // Lấy Lịch sử Giao dịch (User Trades) của đồng Coin này từ mốc lệnh cũ nhất
          let binanceTrades = [];
          try {
              const oldestTime = new Date(symLogs[0].created_at).getTime();
              const tradeRes = await fetch(`/api/binance?path=/fapi/v1/userTrades&symbol=${sym}&startTime=${oldestTime}&isPrivate=true&limit=1000&t=${ts}`);
              if (tradeRes.ok) binanceTrades = await tradeRes.json();
          } catch(e) { console.warn(`Lỗi fetch trades cho ${sym}`, e); }

          // 3. Đối chiếu từng lệnh trong dòng thời gian
          for (let i = 0; i < symLogs.length; i++) {
              const log = symLogs[i];
              const nextLog = symLogs[i+1]; // Dùng để chặn mốc thời gian, không cho PnL lẹm sang lệnh sau
              
              const logStartTime = new Date(log.created_at).getTime();
              const logEndTime = nextLog ? new Date(nextLog.created_at).getTime() : Date.now();

              // CẮT LÁT THỜI GIAN: Chỉ lấy các giao dịch Binance thuộc về chu kỳ của lệnh này
              const cycleTrades = binanceTrades.filter(t => t.time >= logStartTime && t.time < logEndTime);
              
              // TRẠNG THÁI 1: LỆNH CHỜ KHỚP (PENDING)
              if (log.status === 'PENDING') {
                 if (positionAmt !== 0) {
                    const realEntry = parseFloat(currentPosition.entryPrice);
                    await supabase.from('trade_logs').update({ status: 'OPEN', entry: realEntry }).eq('id', log.id);
                    updatedCount++;
                 }
              } 
              // TRẠNG THÁI 2: LỆNH ĐANG CHẠY (OPEN)
              else if (log.status === 'OPEN') {
                 if (positionAmt === 0) { 
                    // Vị thế đã biến mất -> Lệnh đã đóng -> Tính PnL
                    let finalPnl = 0; let exitPrice = autoData?.currentPrice || parseFloat(log.entry);
                    
                    const closingTrades = cycleTrades.filter(t => parseFloat(t.realizedPnl) !== 0);
                    if (closingTrades.length > 0) {
                        const rawPnl = closingTrades.reduce((sum, t) => sum + parseFloat(t.realizedPnl), 0);
                        const totalFee = closingTrades.reduce((sum, t) => sum + parseFloat(t.commission), 0);
                        finalPnl = rawPnl - totalFee; // PNL RÒNG
                        const totalQty = closingTrades.reduce((sum, t) => sum + parseFloat(t.qty), 0);
                        const totalCost = closingTrades.reduce((sum, t) => sum + (parseFloat(t.price) * parseFloat(t.qty)), 0);
                        exitPrice = totalCost / totalQty; 
                    } else {
                        // Fallback
                        const sizeCoin = parseFloat(log.risk_amount_usd) / Math.abs(parseFloat(log.entry) - parseFloat(log.sl));
                        finalPnl = log.direction === 'LONG' ? (exitPrice - parseFloat(log.entry)) * sizeCoin : (parseFloat(log.entry) - exitPrice) * sizeCoin;
                    }

                    await supabase.from('trade_logs').update({ 
                        status: finalPnl > 0 ? 'WIN' : 'LOSS', pnl_usd: finalPnl, close_price: exitPrice,
                        exit_reason: finalPnl > 0 ? 'TP_OR_MANUAL_PROFIT' : 'SL_OR_MANUAL_LOSS', close_time: new Date().toISOString()
                    }).eq('id', log.id);
                    updatedCount++;
                 } else { 
                    // Đang chạy -> Cập nhật MFE / MAE
                    const livePnl = parseFloat(currentPosition.unRealizedProfit);
                    let newMfe = log.max_favorable_excursion_usd || 0; let newMae = log.max_adverse_excursion_usd || 0;
                    let requiresUpdate = false;
                    if (livePnl > newMfe) { newMfe = livePnl; requiresUpdate = true; }
                    if (livePnl < newMae) { newMae = livePnl; requiresUpdate = true; }
                    if (requiresUpdate) await supabase.from('trade_logs').update({ max_favorable_excursion_usd: newMfe, max_adverse_excursion_usd: newMae }).eq('id', log.id);
                 }
              }
              // TRẠNG THÁI 3: LỆNH ĐÃ ĐÓNG (WIN / LOSS) -> KIỂM TOÁN LẠI PNL
              else if (log.status === 'WIN' || log.status === 'LOSS') {
                  const closingTrades = cycleTrades.filter(t => parseFloat(t.realizedPnl) !== 0);
                  if (closingTrades.length > 0) {
                      const rawPnl = closingTrades.reduce((sum, t) => sum + parseFloat(t.realizedPnl), 0);
                      const totalFee = closingTrades.reduce((sum, t) => sum + parseFloat(t.commission), 0);
                      const exactNetPnl = rawPnl - totalFee;
                      
                      const currentRecordedPnl = parseFloat(log.pnl_usd || 0);
                      
                      // Nếu sai lệch PnL lớn hơn 0.01$ (Bỏ qua sai số thập phân), cập nhật lại Supabase
                      if (Math.abs(exactNetPnl - currentRecordedPnl) > 0.01) {
                          await supabase.from('trade_logs').update({ 
                              pnl_usd: exactNetPnl,
                              // Đảm bảo trạng thái WIN/LOSS phản ánh đúng PnL sau khi đã trừ phí
                              status: exactNetPnl > 0 ? 'WIN' : 'LOSS' 
                          }).eq('id', log.id);
                          updatedCount++;
                          console.log(`[AUDIT] Đã truy thu/bù trừ PnL cho lệnh ${log.symbol}. Cũ: ${currentRecordedPnl}$ -> Mới: ${exactNetPnl}$`);
                      }
                  }
              }
          }
      }

      if (updatedCount > 0) {
          showToast(`✅ Đã đối soát và cập nhật thành công ${updatedCount} lệnh với Máy chủ Binance!`);
      } else {
          showToast(`✅ Sổ cái hoàn hảo. Không có sai lệch PnL nào được phát hiện.`);
      }

    } catch (e) { 
      showToast(`❌ Lỗi đồng bộ: ${e.message}`); 
    } finally { 
      setIsSyncing(false); 
    }
  };

  const handleMasterAuto = () => { 
    if (!autoData || !vectorRegime) return;
    let dir = vectorRegime.details.l1 === 'Trend Up' ? 'LONG' : 'SHORT'; 
    let execType = 'LIMIT'; 
    let suggestedEntry = autoData.currentPrice;

    if (vectorRegime.details.l1 === 'Range' || vectorRegime.details.l2 === 'Extreme') {
       if (autoData.rsi < 45) dir = 'LONG'; 
       else if (autoData.rsi > 55) dir = 'SHORT'; 
       else { 
           dir = autoData.cmf > 0 ? 'LONG' : 'SHORT'; 
           showToast("⚠️ RSI Vùng nhiễu (Chop Zone). Khởi tạo dự phòng theo Dòng tiền CMF."); 
       }
       execType = 'MARKET'; 
       suggestedEntry = autoData.currentPrice; 
    } else {
       suggestedEntry = dir === 'LONG' ? autoData.currentPrice - (0.5 * autoData.atr14) : autoData.currentPrice + (0.5 * autoData.atr14);
    }

    const isSfp = dir === 'LONG' ? autoData.isBullishSFP : autoData.isBearishSFP;
    
    const { tpMult, slMult, strategyName } = QuantMath.dynamicAsymmetricTargets(
        autoData.bbwRank, 
        autoData.bbwSlope, 
        isSfp, 
        autoData.atrPercent, 
        autoData.obi, 
        dir
    );

    const sl = dir === 'LONG' ? suggestedEntry - (slMult * autoData.atr14) : suggestedEntry + (slMult * autoData.atr14);
    const tp1 = dir === 'LONG' ? suggestedEntry + (tpMult * autoData.atr14) : suggestedEntry - (tpMult * autoData.atr14);

    const tick = tickSizes[symbol] || 0.0001;
    const tickStr = parseFloat(tick).toString();
    const precision = tickStr.includes('e-') ? parseInt(tickStr.split('e-')[1]) : (tickStr.includes('.') ? tickStr.split('.')[1].length : 4);

    setTradeSetup(prev => ({ 
      ...prev, 
      direction: dir, 
      execution: execType, 
      entry: Number(suggestedEntry.toFixed(precision)), 
      slTech: Number(sl.toFixed(precision)), 
      tp1: Number(tp1.toFixed(precision)),
      activeStrategy: strategyName 
    }));
    
    if (!(autoData.rsi >= 45 && autoData.rsi <= 55 && (vectorRegime.details.l1 === 'Range' || vectorRegime.details.l2 === 'Extreme'))) {
        showToast(`⚡ KÍCH HOẠT: ${strategyName} | SL: ${slMult.toFixed(2)} ATR | TP: ${tpMult.toFixed(1)} ATR`);
    }
  };

  const injectScannedSetup = (setup) => {
    setSymbol(setup.symbol); setIntervalTime(setup.interval);
    setTradeSetup(prev => ({ 
        ...prev, direction: setup.direction, entry: setup.entry, 
        slTech: setup.slTech, tp1: setup.tp1, 
        activeStrategy: setup.overrideTag || "TIÊU CHUẨN" 
    }));
    showToast(`🚀 Đã nạp cấu trúc ${setup.symbol} [${setup.interval}] lên tổng đài chỉ huy!`);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-200 font-mono p-2 md:p-6 relative overflow-x-hidden">
      {systemError && (
        <div className="fixed top-0 left-0 w-full bg-red-600/90 text-white text-center py-1.5 text-xs font-bold z-[100] flex justify-center items-center gap-2 shadow-lg">
          <ServerCrash className="w-4 h-4 animate-pulse"/> API BINANCE DOWN HOẶC VERCEL BLOCKED!
        </div>
      )}
      {toast && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 px-4 py-2 rounded shadow-2xl flex items-center gap-2">
          <Bell className="w-4 h-4 text-emerald-400" /> <span className="text-xs">{toast}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-center gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-emerald-500 flex items-center gap-2 tracking-tighter">
            <BrainCircuit className="w-7 h-7" /> ANTI-FRAGILE <span className="text-slate-500">V5.5.0 (Quantum Watch)</span>
          </h1>
          <p className="text-slate-500 text-[10px] mt-1 uppercase tracking-widest flex items-center gap-2">
            {lastUpdated ? `Sync: ${lastUpdated.toLocaleTimeString()}` : 'Khởi động Core...'}
            <span className="text-blue-400 border border-blue-900/50 bg-blue-900/10 px-1.5 rounded">{apiMacro.tradingSession}</span>
            {tradeStats.hasEnoughData ? (
               <span className="text-purple-400 border border-purple-900/50 bg-purple-900/10 px-1.5 rounded">
                 WR: {Number(tradeStats.winRate * 100 || 0).toFixed(1)}% | RR: {Number(tradeStats.historicalRR || 0).toFixed(2)}
               </span>
            ) : (
               <span className="text-amber-500 border border-amber-900/50 bg-amber-900/10 px-1.5 rounded">COLD START N={tradeStats.totalClosed}/30</span>
            )}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className={`px-2 py-1 rounded text-[9px] font-bold border flex flex-col items-center ${systemHealth.weight > 2000 ? 'bg-red-950/50 text-red-400 border-red-900 animate-pulse' : systemHealth.weight > 1200 ? 'bg-amber-950/50 text-amber-400 border-amber-900' : 'bg-slate-900/50 text-emerald-400 border-slate-700'}`}>
              <span>API LIMIT: {systemHealth.weight}/{systemHealth.maxWeight}</span>
              <span className={`text-[7px] ${systemHealth.latency > 3000 ? 'text-red-500 animate-pulse' : 'text-slate-500'}`}>VERCEL RTT: {systemHealth.latency}ms</span>
          </div>

          <div className="flex items-center gap-2 bg-slate-900/50 p-1.5 rounded border border-slate-800">
            <select className="bg-black text-emerald-400 font-bold px-3 py-1.5 rounded border border-slate-700/50 outline-none text-sm cursor-pointer" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {dynamicPool.map(sym => (
                <option key={sym} value={sym}>{sym.replace('USDT', '/USDT')}</option>
              ))}
            </select>
            <select className="bg-black text-blue-400 font-bold px-3 py-1.5 rounded border border-slate-700/50 outline-none text-sm cursor-pointer" value={intervalTime} onChange={(e) => setIntervalTime(e.target.value)}>
              <option value="5m">M5 (Scalp)</option><option value="15m">M15 (Day)</option><option value="1h">H1 (Swing)</option>
              <option value="4h">H4 (Macro)</option><option value="1d">D1 (Trend)</option>
            </select>
            <div className="px-3 border-l border-slate-700/50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500"/> : <Activity className="w-4 h-4 text-emerald-500"/>}
            </div>
          </div>
        </div>
      </div>

      <MatrixScanner
        scannedTopSetups={scannedTopSetups}
        isScanningBackground={isScanningBackground}
        sonarEnabled={sonarEnabled}
        setSonarEnabled={setSonarEnabled}
        injectScannedSetup={injectScannedSetup}
      />

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-6">
          <LiveMetrics autoData={autoData} apiMacro={apiMacro} cmcData={cmcData} indicatorSpecs={indicatorSpecs} mvrvZScore={mvrvZScore} setMvrvZScore={setMvrvZScore} />
          <VectorState vectorRegime={vectorRegime} mvrvZScore={mvrvZScore} autoData={autoData} />
          <OrderForm 
            autoData={autoData} tradeSetup={tradeSetup} setTradeSetup={setTradeSetup} 
            liveCapital={liveCapital} mathCore={mathCore} tradeStats={tradeStats} 
            symbol={symbol} handleMasterAuto={handleMasterAuto} 
            stepSizes={stepSizes} tickSizes={tickSizes}
          />
          <TradeJournal 
            tradeLogs={tradeLogs} 
            currentPrice={autoData?.currentPrice} 
            syncBinanceToSupabase={syncBinanceToSupabase} 
            isSyncing={isSyncing} 
            binancePositions={binancePositions}
          />
        </div>

        <div className="lg:col-span-5 flex flex-col gap-6">
          <LogicGates logicGates={logicGates} tradeSetup={tradeSetup} mathCore={mathCore} handleSaveTradeLog={handleSaveTradeLog} />
          <AiAudit autoData={autoData} runGeminiAnalysis={runGeminiAnalysis} isAnalyzing={isAnalyzing} geminiCooldown={geminiCooldown} aiAnalysis={aiAnalysis} />
        </div>
      </div>
    </div>
  );
}
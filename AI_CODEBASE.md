--- START OF FILE Paste Jul 09, 2026, 02:00 AM ---

=========================================
/// FILE: src\App.jsx
=========================================

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

=========================================
/// FILE: src\components\scanner\MatrixScanner.jsx
=========================================

import React from 'react';
import { Crosshair, Loader2, Bell, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { getMinNotional } from '../../config/constants';

export default function MatrixScanner({
  scannedTopSetups,
  isScanningBackground,
  sonarEnabled,
  setSonarEnabled,
  injectScannedSetup
}) {
  return (
    <div className="max-w-7xl mx-auto mb-6">
      <div className="bg-[#111116] border border-emerald-900/50 rounded-xl p-4 shadow-xl">
        <div className="flex justify-between items-center border-b border-emerald-900/30 pb-2 mb-3">
          <h3 className="text-xs font-black text-emerald-400 flex items-center gap-2 tracking-widest uppercase">
            <Crosshair className="w-4 h-4 animate-pulse text-emerald-400" /> MATRIX SCANNER: ALPHA ASSETS (GATES PASSED)
          </h3>
          <div className="flex items-center gap-3 text-[9px] text-slate-500 font-mono">
            <button
              onClick={() => setSonarEnabled(!sonarEnabled)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-all ${
                sonarEnabled
                  ? 'bg-emerald-950 text-emerald-400 border-emerald-500/50'
                  : 'bg-slate-900 text-slate-500 border-slate-700'
              }`}
            >
              <Bell className={`w-3 h-3 ${sonarEnabled ? 'animate-bounce' : ''}`} />
              {sonarEnabled ? 'SONAR: ON' : 'SONAR: OFF'}
            </button>

            {isScanningBackground ? (
              <span className="flex items-center gap-1 text-amber-400 animate-pulse">
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> DEEP RE-INDEXING...
              </span>
            ) : (
              <span>40S/CYCLE</span>
            )}
          </div>
        </div>

        {scannedTopSetups.length === 0 ? (
          <div className="text-center py-4 text-slate-600 text-xs font-bold uppercase tracking-wider animate-pulse">
            Khởi động Động cơ Lượng tử, rà soát Logic Gates 45 vùng không gian...
          </div>
        ) : scannedTopSetups[0]?.isEmpty ? (
          <div className="text-center py-4 text-amber-500/80 bg-amber-950/10 border border-amber-900/30 rounded text-xs font-bold uppercase tracking-wider">
            ⚠️ KHÔNG CÓ SETUP NÀO ĐẠT TIÊU CHUẨN LOGIC GATES TRONG CHU KỲ NÀY. ĐỨNG NGOÀI LÀ BẢO VỆ VỐN.
          </div>
        ) : (
          <div
            className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-2"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#065f46 #0a0a0c' }}
          >
            {scannedTopSetups.map((setup, idx) => (
              <div
                key={idx}
                className="bg-black/40 border border-slate-800/80 rounded p-2.5 flex flex-col md:flex-row items-start md:items-center justify-between hover:border-emerald-500/40 hover:bg-black/60 transition-all group gap-3 md:gap-0"
              >
                <div className="flex items-center gap-3 w-full md:w-1/5">
                  <span
                    className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${
                      idx === 0
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-900/50'
                        : idx === 1
                        ? 'bg-blue-950 text-blue-400 border-blue-900/50'
                        : idx === 2
                        ? 'bg-purple-950 text-purple-400 border-purple-900/50'
                        : 'bg-slate-900 text-slate-400 border-slate-700'
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  <div>
                    <div className="text-xs font-black text-white flex items-center gap-1">
                      {setup.symbol}
                      {setup.overrideTag && (
                        <span className="text-[7.5px] font-black bg-purple-900/50 border border-purple-500/50 text-purple-400 px-1 rounded shadow-[0_0_8px_rgba(168,85,247,0.4)] animate-pulse">
                          {setup.overrideTag}
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] font-bold text-blue-400">{setup.interval}</div>
                  </div>
                </div>

                <div className="flex flex-col w-full md:w-1/4">
                  <div className="flex items-center gap-1 text-[10px] font-bold">
                    {setup.direction === 'LONG' ? (
                      <TrendingUp className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <TrendingDown className="w-3 h-3 text-red-500" />
                    )}
                    <span className={setup.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>
                      {setup.direction}
                    </span>
                  </div>
                  <div className="text-[9.5px] text-slate-400 font-mono mt-0.5">
                    E: <span className="text-white">${setup.entry}</span>{' '}
                    <span className="mx-1">|</span> S:{' '}
                    <span className="text-red-400">${setup.slTech}</span>
                  </div>
                </div>

                <div className="flex flex-col w-full md:w-1/4 font-mono">
                  <div className="text-[10.5px]">
                    <span className="text-slate-500">NET R:R</span>{' '}
                    <span className="text-emerald-400 font-black">1 : {setup.theoreticalRR}</span>
                  </div>
                  <div className="text-[9.5px] flex gap-3 mt-0.5">
                    <span>
                      RSI: <span className="text-cyan-400">{setup.rsi}</span>
                    </span>
                    <span>
                      CMF:{' '}
                      <span className={parseFloat(setup.cmf) > 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {setup.cmf}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="flex flex-row md:flex-col justify-between md:justify-start w-full md:w-1/6 font-mono text-[9.5px] text-slate-400">
                  <div>
                    Lev: <span className="text-amber-400 font-bold">{setup.suggestedLeverage}x</span>
                  </div>
                  <div>
                    Min Size: <span className="text-purple-400">${getMinNotional(setup.symbol)}</span>
                  </div>
                </div>

                <div className="w-full md:w-auto flex justify-end">
                  <button
                    onClick={() => injectScannedSetup(setup)}
                    className="text-[9px] bg-blue-950/50 hover:bg-blue-600/30 text-blue-400 font-bold px-3 py-1.5 rounded border border-blue-900/50 transition-colors flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 w-full md:w-auto"
                  >
                    <Zap className="w-3 h-3" /> <span>LOAD TO HUD</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

=========================================
/// FILE: src\components\terminal\AiAudit.jsx
=========================================

import React from 'react';
import { Bot, Database, Loader2 } from 'lucide-react';

export default function AiAudit({
  autoData,
  runGeminiAnalysis,
  isAnalyzing,
  geminiCooldown,
  aiAnalysis
}) {
  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl">
       <h2 className="text-[10px] font-bold text-blue-400 uppercase flex items-center gap-2 mb-3">
         <Bot className="w-3.5 h-3.5" /> QUANTUM COUNCIL AUDIT (5 AGENTS LITE &rarr; MASTER 3.5)
       </h2>
       <button 
         onClick={runGeminiAnalysis} 
         disabled={isAnalyzing || !autoData || geminiCooldown > 0} 
         className={`w-full py-2 border rounded text-[10px] font-bold flex items-center justify-center gap-2 transition-all bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border-blue-500/30`}
       >
         {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
         KÍCH HOẠT HỘI ĐỒNG KIỂM TOÁN LỆNH 
       </button>
       {aiAnalysis && (
         <div className="mt-3 bg-[#0a0a0c] p-3 rounded border border-blue-900/30 text-[10.5px] text-slate-300 whitespace-pre-line leading-relaxed shadow-inner font-mono max-h-96 overflow-y-auto">
           <span className="text-blue-500 mr-1">{'>'}</span> {aiAnalysis}
         </div>
       )}
    </div>
  );
}

=========================================
/// FILE: src\components\terminal\LiveMetrics.jsx
=========================================

import React from 'react';
import { Database } from 'lucide-react';

export default function LiveMetrics({ 
  autoData, 
  apiMacro, 
  cmcData, 
  indicatorSpecs, 
  mvrvZScore, 
  setMvrvZScore 
}) {
  return (
    <div className="bg-[#111116] border border-blue-900/40 rounded-xl p-4 shadow-xl space-y-4">
      <h2 className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2 border-b border-blue-900/30 pb-2">
        <Database className="w-3.5 h-3.5" /> LIVE DATA & ORDERBOOK METRICS
      </h2>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">MARK PRICE</label>
          <div className="font-black text-sm text-white">${autoData?.currentPrice?.toFixed(4) || '0.00'}</div>
        </div>
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-emerald-500 block mb-1 font-bold">EMA (20/50/200)</label>
          <div className="font-bold text-xs text-indigo-300">
            ${autoData?.ema20?.value?.toFixed(4) || '0.0000'} <span className="text-slate-600 mx-0.5">/</span> <span className="text-purple-300">${autoData?.ema50?.value?.toFixed(4) || '0.0000'}</span> <span className="text-slate-600 mx-0.5">/</span> <span className="text-amber-500">${autoData?.ema200?.value?.toFixed(4) || '0.0000'}</span>
          </div>
        </div>
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-cyan-400 font-bold block mb-1">TAKER BUY/SELL</label>
          <div className={`font-black text-sm ${apiMacro.takerBuySellRatio > 1.05 ? 'text-emerald-500' : apiMacro.takerBuySellRatio < 0.95 ? 'text-red-500' : 'text-slate-300'}`}>
            {apiMacro.takerBuySellRatio?.toFixed(2) || '1.00'}
          </div>
        </div>
        <div className="bg-[#0c0c10] p-2 rounded border border-amber-900/50">
          <label className="text-[8px] text-amber-500 block mb-1 font-bold">REAL SPREAD</label>
          <div className="font-black text-xs text-amber-400">{apiMacro.realSpreadPct?.toFixed(4)}%</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">ADX (TREND)</label>
          <div className={`font-black text-sm ${autoData?.adx > 25 ? 'text-amber-400' : 'text-slate-400'}`}>{autoData?.adx?.toFixed(1) || '0'}</div>
        </div>
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">RSI ({indicatorSpecs.rsiPeriod})</label>
          <div className={`font-black text-sm ${autoData?.rsi > 70 ? 'text-red-500' : autoData?.rsi < 30 ? 'text-emerald-500' : 'text-cyan-400'}`}>{autoData?.rsi?.toFixed(1) || '0'}</div>
        </div>
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">ATR RANK (100 Kỳ)</label>
          <div className="font-bold text-xs text-slate-300">P{autoData?.atrRank?.toFixed(0) || '0'} <span className="text-[8px] text-slate-600">(${autoData?.atr14?.toFixed(2)})</span></div>
        </div>
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">BBW RANK (100 Kỳ)</label>
          <div className={`font-bold text-xs ${autoData?.bbwRank < 20 ? 'text-pink-500 animate-pulse' : 'text-slate-300'}`}>P{autoData?.bbwRank?.toFixed(0) || '0'} <span className="text-[8px] font-normal">({autoData?.bbw?.toFixed(2)}%)</span></div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <div className="bg-slate-900/50 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">CHAIKIN CMF</label>
          <div className={`font-bold text-xs ${autoData?.cmf > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{autoData?.cmf?.toFixed(2) || '0.00'}</div>
        </div>
        <div className="bg-slate-900/50 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">L/S VOL RATIO</label>
          <div className="font-bold text-xs text-slate-300">
            <span className={apiMacro.lsPositionVolRatio > 1.5 ? 'text-amber-500' : ''}>{apiMacro.lsPositionVolRatio?.toFixed(2)}</span>
          </div>
        </div>
        <div className="bg-slate-900/50 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">FUNDING SLOPE</label>
          <div className={`font-bold text-[10px] ${Math.abs(autoData?.fundingSlope) > 0.05 ? 'text-amber-400' : 'text-slate-300'}`}>{autoData?.fundingSlope?.toFixed(4) || '0'}</div>
        </div>
        <div className="bg-slate-900/50 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-amber-400 font-bold block mb-1">OI DELTA (%)</label>
          <div className={`font-bold text-[10px] ${autoData?.oiDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {autoData?.oiDelta > 0 ? '+' : ''}{autoData?.oiDelta?.toFixed(2)}%
          </div>
        </div>
        <div className="bg-slate-900/50 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">BTC DOM (SLOPE)</label>
          <div className="flex items-center justify-between">
             <span className="font-bold text-[10px] text-slate-300">{autoData?.btcDomValue?.toFixed(1)}%</span>
             <span className={`font-bold text-[9px] ${autoData?.btcDomSlope > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {autoData?.btcDomSlope > 0 ? '+' : ''}{autoData?.btcDomSlope?.toFixed(2)}%
             </span>
          </div>
        </div>
        <div className="bg-[#0c0c10] p-2 rounded border border-blue-900/30 flex flex-col justify-center">
           <label className="text-[8px] font-bold text-blue-400 block mb-1">MVRV Z-SCORE</label>
           <input type="number" step="0.1" value={mvrvZScore} onChange={(e) => setMvrvZScore(Number(e.target.value))} className="w-full bg-transparent text-white font-bold outline-none text-xs border-b border-slate-700/50 focus:border-blue-500 pb-0.5"/>
        </div>
      </div>
    </div>
  );
}

=========================================
/// FILE: src\components\terminal\LogicGates.jsx
=========================================

import React from 'react';
import { ShieldAlert, CheckCircle2, XCircle, AlertTriangle, ClipboardList, Zap, Target, TrendingUp, Save } from 'lucide-react';

export default function LogicGates({
  logicGates,
  tradeSetup,
  mathCore,
  handleSaveTradeLog
}) {
  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 flex-grow flex flex-col shadow-xl">
       <h2 className="text-[10px] font-bold text-slate-300 uppercase mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
         <ShieldAlert className="w-4 h-4 text-emerald-500" /> BỘ LỌC CỔNG KIỂM DUYỆT (LOGIC GATES)
       </h2>

       <div className="mb-2">
          <span className="text-[8px] font-black text-red-500 uppercase tracking-widest block mb-2 border-b border-slate-800 pb-1">Cửa Tử - Hard Gates (Bắt buộc 100%)</span>
          <div className="space-y-2">
            {logicGates.hardGates.map((item) => (
              <div key={item.id} className="flex items-start gap-2.5 bg-red-950/10 p-2 rounded border border-red-900/20">
                {item.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />}
                <span className={`text-[9.5px] leading-relaxed font-bold ${item.passed ? 'text-slate-300' : 'text-red-400'}`}>{item.text}</span>
              </div>
            ))}
          </div>
       </div>

       <div className="flex-grow mt-3">
          <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest block mb-2 border-b border-slate-800 pb-1">
             Cửa Mềm - Adaptive Soft Gates (Yêu cầu &ge; 6.5/10.0 | Hiện tại: <span className={logicGates.softScore >= 6.5 ? "text-emerald-400" : "text-amber-500"}>{logicGates.softScore.toFixed(1)}</span>)
          </span>
          <div className="space-y-2">
            {logicGates.softGates.map((item) => {
              if (item.weight === 0) return null; 
              return (
                <div key={item.id} className="flex items-start gap-2.5 bg-blue-950/10 p-2 rounded border border-blue-900/20 transition-all">
                  {item.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-slate-700 shrink-0 mt-0.5" />}
                  <span className={`text-[9.5px] leading-relaxed font-medium ${item.passed ? 'text-slate-300' : 'text-slate-600 line-through'}`}>{item.text}</span>
                </div>
              )
            })}
          </div>
       </div>

       <div className="mt-5 pt-5 border-t border-slate-800 flex flex-col gap-3">
          {!logicGates.isApproved ? (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-[9px] p-2 rounded flex items-center gap-1.5 font-bold">
              <AlertTriangle className="w-3 h-3 shrink-0" /> LỆNH BỊ HỆ THỐNG KHÓA VÌ RỚT LOGIC GATES.
            </div>
          ) : (
            <div className="bg-emerald-950/20 border border-emerald-500/30 p-3 rounded text-[10px]">
              <div className="font-black text-emerald-400 mb-2 flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5"/> THÔNG SỐ ĐÁNH TAY TRÊN BINANCE:</div>
              <ul className="text-slate-300 space-y-1 font-mono pl-1">
                 <li>[1] Hướng lệnh: <strong className={tradeSetup.direction==='LONG'?'text-emerald-400':'text-red-400'}>{tradeSetup.direction}</strong> ({tradeSetup.execution})</li>
                 <li className="text-amber-400">[2] Khối lượng (Size USD): <strong>${mathCore.positionSizeUSD}</strong></li>
                 <li>[3] Giá Entry: <strong>{tradeSetup.entry}</strong></li>
                 <li>[4] Stoploss Cứng: <strong>{tradeSetup.slTech}</strong></li>
                 <li className="text-red-400 uppercase mt-2 pt-1 border-t border-emerald-900/50">[5] Margin Mode: <strong>ISOLATED (BẮT BUỘC)</strong> | Leverage: <strong>{mathCore.suggestedLeverage}x</strong></li>
              </ul>
            </div>
          )}
          
          {logicGates.isNanoOverride && (
            <div className="bg-pink-500/20 border border-pink-500/50 p-2 rounded mt-2 text-[9px] font-bold text-pink-400 flex items-center gap-1.5 animate-pulse shadow-[0_0_10px_rgba(236,72,153,0.2)]">
                <Zap className="w-3.5 h-3.5 shrink-0" /> NANO-CAP SNIPER (VỐN NHỎ): Bẻ khóa Hard Gates (H3/H6) nhờ R:R Siêu ngạch (>=2.5) & Dòng tiền kẹt (Squeeze/SFP). Cược rủi ro thấp!
            </div>
          )}

          {logicGates.isGoldenOverride && (
            <div className="bg-amber-500/20 border border-amber-500/50 p-2 rounded mt-2 text-[9px] font-bold text-amber-400 flex items-center gap-1.5 animate-pulse">
                <Zap className="w-3.5 h-3.5" /> GOLDEN TICKET OVERRIDE: Setup đạt ngưỡng siêu hợp lưu (&ge; 8.5). Bẻ cong Hard Gates Regime (Transition/Compression) để tiến hành Squeeze!
            </div>
          )}

          {logicGates.isSniperOverride && (
            <div className="bg-purple-500/20 border border-purple-500/50 p-2 rounded mt-2 text-[9px] font-bold text-purple-400 flex items-center gap-1.5 animate-pulse">
                <Target className="w-3.5 h-3.5 shrink-0" /> SNIPER SFP OVERRIDE: Đặc cách vượt lỗi SL quá sát (H1) nhờ cấu trúc quét SFP (Điểm &ge; 7.0). Tối ưu Position Size!
            </div>
          )}
          
          {logicGates.isHighRROverride && (
            <div className="bg-cyan-500/20 border border-cyan-500/50 p-2 rounded mt-2 text-[9px] font-bold text-cyan-400 flex items-center gap-1.5 animate-pulse">
                <TrendingUp className="w-3.5 h-3.5 shrink-0" /> ASYMMETRIC PAYOFF OVERRIDE: Đặc cách vượt lỗi Volume cạn (H6) nhờ R:R ròng siêu cao (&ge; 2.5). Đòn bẩy tỷ lệ cược vốn nhỏ!
            </div>
          )}

          <button disabled={!logicGates.isApproved} onClick={handleSaveTradeLog} className={`w-full py-3 rounded-lg font-black text-[10px] tracking-widest flex items-center justify-center gap-2 transition-all duration-300 shadow-xl
              ${logicGates.isApproved ? 'bg-slate-800 text-white hover:bg-slate-700 border border-slate-600' : 'bg-slate-800/20 text-slate-700 border border-slate-800 cursor-not-allowed'}`}>
            <Save className="w-4 h-4"/> LƯU VÀO SỔ TAY SUPABASE
          </button>
       </div>
    </div>
  );
}

=========================================
/// FILE: src\components\terminal\OrderForm.jsx
=========================================

// FILE: src/components/terminal/OrderForm.jsx
import React, { useState } from 'react';
import { Zap, TrendingUp, TrendingDown, BarChart3, Lock, Rocket, Loader2, Target, FileSignature } from 'lucide-react'; // Đã thêm FileSignature

export default function OrderForm({
  autoData, tradeSetup, setTradeSetup, liveCapital, mathCore, tradeStats,
  symbol, handleMasterAuto, stepSizes, tickSizes
}) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [execStatus, setExecStatus] = useState('');

  // -------------------------------------------------------------
  // HÀM MỚI: 1-Click Ký Hợp Đồng TradFi
  // -------------------------------------------------------------
  const handleSignTradFi = async () => {
    setIsExecuting(true);
    setExecStatus('⏳ Đang liên kết API để ký hợp đồng TradFi với Binance...');
    try {
      const res = await fetch('/api/binance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'SIGN_TRADFI' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details?.msg || data.error || 'Lỗi khi ký.');
      setExecStatus('✅ ĐÃ KÝ HỢP ĐỒNG TRADFI THÀNH CÔNG! BẠN ĐÃ CÓ THỂ PHÓNG LỆNH.');
    } catch (err) {
      setExecStatus('❌ LỖI KÝ TRADFI: ' + err.message);
    }
    setIsExecuting(false);
  };

  const handleExecuteBatch = async () => {
    if (mathCore.hasMinNotionalError || tradeSetup.entry <= 0 || tradeSetup.slTech <= 0) {
        setExecStatus('❌ LỖI SETUP: Check lại Min Notional hoặc Entry/SL');
        return;
    }

    setIsExecuting(true);
    setExecStatus('Đang tiền trạm & Phóng lệnh...');

    try {
        const step = stepSizes[symbol] || 0.001;
        const tick = tickSizes[symbol] || 0.001;

        const formatPrecision = (val, size) => {
            let strVal = String(val);
            if (strVal.includes(',')) strVal = strVal.includes('.') ? strVal.replace(/,/g, '') : strVal.replace(/,/g, '.');
            const cleanNum = parseFloat(strVal);

            const sizeStr = parseFloat(size).toString();
            let precision = 0;
            if (sizeStr.includes('e-')) precision = parseInt(sizeStr.split('e-')[1]);
            else if (sizeStr.includes('.')) precision = sizeStr.split('.')[1].length;

            return isNaN(cleanNum) ? "0" : cleanNum.toFixed(precision);
        };

        const rawQty = parseFloat(mathCore.positionSizeUSD) / tradeSetup.entry;
        const finalQty = formatPrecision(rawQty, step);
        const finalEntry = formatPrecision(tradeSetup.entry, tick);
        const finalSl = formatPrecision(tradeSetup.slTech, tick);
        const finalTp = formatPrecision(tradeSetup.tp1, tick);

        if (tradeSetup.tradeType === 'FUTURES') {
            const batch = [];
            const side = tradeSetup.direction === 'LONG' ? 'BUY' : 'SELL';
            const exitSide = tradeSetup.direction === 'LONG' ? 'SELL' : 'BUY';

            batch.push({
                symbol: symbol,
                side: side,
                type: tradeSetup.execution,
                quantity: finalQty,
                ...(tradeSetup.execution === 'LIMIT' ? { price: finalEntry, timeInForce: 'GTC' } : {})
            });

            if (parseFloat(finalSl) > 0) {
                batch.push({ 
                    symbol: symbol, side: exitSide, type: 'STOP_MARKET', 
                    triggerPrice: finalSl, quantity: finalQty, reduceOnly: "true", workingType: "MARK_PRICE", priceProtect: "true" 
                });
            }

            if (parseFloat(finalTp) > 0) {
                batch.push({ 
                    symbol: symbol, side: exitSide, type: 'TAKE_PROFIT_MARKET', 
                    triggerPrice: finalTp, quantity: finalQty, reduceOnly: "true", workingType: "MARK_PRICE", priceProtect: "true" 
                });
            }

            const payload = {
                symbol: symbol,
                leverage: mathCore.suggestedLeverage,
                marginType: 'ISOLATED',
                batchOrders: batch
            };

            const LOCAL_BRIDGE_URL = 'http://localhost:1337/api/execute-batch';
            
            const res = await fetch(LOCAL_BRIDGE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const data = await res.json();
            if (!res.ok) throw new Error(data.details?.msg || data.error || 'Bridge Cục bộ từ chối.');

            if (Array.isArray(data)) {
                const errors = data.filter(r => r.error === true || r.code !== undefined);
                if (errors.length > 0) {
                    console.error("LỖI CHI TIẾT TỪ BINANCE:", errors);
                    throw new Error(`Entry đã khớp nhưng sàn TỪ CHỐI lệnh (Gợi ý: ${errors[0]?.msg}). Vui lòng check ngay trên App Binance!`);
                }
            }

            setExecStatus('✅ ĐÃ KHỚP CỤM LỆNH LIÊN HOÀN!');
            setTimeout(() => setExecStatus(''), 5000);
        } else {
            setExecStatus('❌ Cụm lệnh hiện chỉ hỗ trợ Futures.');
        }
    } catch (err) {
        setExecStatus('❌ LỖI: ' + err.message);
    }
    setIsExecuting(false);
  };

  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl">
      <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
        <button onClick={handleMasterAuto} disabled={!autoData} className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-2">
          <Zap className="w-3 h-3" /> AUTO SYNC TEMPLATE
        </button>

        <button 
          onClick={handleExecuteBatch} 
          disabled={isExecuting || !autoData} 
          className={`px-4 py-1.5 rounded text-[10px] font-black flex items-center gap-2 transition-all shadow-lg
            ${isExecuting ? 'bg-slate-800 text-slate-500' : 'bg-emerald-600 text-black hover:bg-emerald-500 border border-emerald-400'}`}
        >
          {isExecuting ? <Loader2 className="w-3 h-3 animate-spin"/> : <Rocket className="w-3 h-3" />} 
          PHÓNG CỤM LỆNH BINANCE
        </button>
      </div>

      {execStatus && (
          <div className={`mb-3 text-[10px] font-bold p-2 rounded border flex flex-col gap-2 ${execStatus.includes('✅') ? 'bg-emerald-950/30 text-emerald-400 border-emerald-900' : 'bg-red-950/30 text-red-400 border-red-900'} animate-pulse`}>
              <span>{execStatus}</span>
              
              {/* NÚT BYPASS HIỆN RA KHI CÓ LỖI TRADFI */}
              {execStatus.includes('TradFi-Perps') && (
                  <button 
                    onClick={handleSignTradFi} 
                    disabled={isExecuting}
                    className="bg-amber-600/20 text-amber-400 border border-amber-500/50 px-3 py-1.5 rounded w-max hover:bg-amber-600/40 flex items-center gap-1.5 transition-all shadow-[0_0_10px_rgba(217,119,6,0.3)]"
                  >
                     {isExecuting ? <Loader2 className="w-3 h-3 animate-spin"/> : <FileSignature className="w-3 h-3" />}
                     KÝ HỢP ĐỒNG TRADFI (1-CLICK BYPASS)
                  </button>
              )}
          </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'FUTURES'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded shadow-sm ${tradeSetup.tradeType === 'FUTURES' ? 'bg-indigo-500 text-white' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}>FUTURES</button>
            <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'SPOT'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded shadow-sm ${tradeSetup.tradeType === 'SPOT' ? 'bg-amber-500 text-black' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}>SPOT</button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setTradeSetup({...tradeSetup, direction: 'LONG'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded flex justify-center gap-1 shadow-sm ${tradeSetup.direction === 'LONG' ? 'bg-emerald-500 text-black' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}><TrendingUp className="w-3 h-3"/> LONG</button>
            <button onClick={() => setTradeSetup({...tradeSetup, direction: 'SHORT'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded flex justify-center gap-1 shadow-sm ${tradeSetup.direction === 'SHORT' ? 'bg-red-500 text-white' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}><TrendingDown className="w-3 h-3"/> SHORT</button>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
             <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 col-span-2 flex flex-col gap-2">
                <div className="flex justify-between">
                  <div className="w-1/2 pr-2 border-r border-slate-800">
                    <label className="text-[8px] font-bold text-slate-400 block mb-1">LIVE CAPITAL (API VÍ)</label>
                    <div className="text-emerald-400 font-bold text-sm">${liveCapital.toFixed(2)}</div>
                  </div>
                  <div className="w-1/2 pl-2">
                    <label className="text-[8px] font-bold text-slate-400 block mb-1">BASE RISK: {tradeSetup.riskPercent}%</label>
                    <input type="number" step="0.1" max="5" value={tradeSetup.riskPercent} onChange={e=>setTradeSetup({...tradeSetup, riskPercent: Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-800/50">
                   <input type="range" min="0.1" max="5.0" step="0.1" value={tradeSetup.riskPercent} onChange={e=>setTradeSetup({...tradeSetup, riskPercent: Number(e.target.value)})} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"/>
                </div>
             </div>
             <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
              <label className="text-[8px] font-bold text-slate-400 block mb-1">ENTRY PRICE</label>
              <input type="number" value={tradeSetup.entry} onChange={e=>setTradeSetup({...tradeSetup, entry:Number(e.target.value)})} className="w-full bg-transparent text-white font-bold outline-none text-sm"/>
             </div>
             <div className="bg-red-950/20 p-2 rounded border border-red-900/50">
              <label className="text-[8px] font-bold text-red-500 block mb-1">TECH STOPLOSS</label>
              <input type="number" value={tradeSetup.slTech} onChange={e=>setTradeSetup({...tradeSetup, slTech:Number(e.target.value)})} className="w-full bg-transparent text-red-400 font-bold outline-none text-sm"/>
             </div>
             <div className="bg-emerald-950/20 p-2 rounded border border-emerald-900/50 col-span-2">
              <label className="text-[8px] font-bold text-emerald-500 block mb-1">TAKE PROFIT (WORST-CASE EV)</label>
              <input type="number" value={tradeSetup.tp1} onChange={e=>setTradeSetup({...tradeSetup, tp1:Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
             </div>
          </div>
        </div>

        <div className={`bg-gradient-to-br p-4 rounded-lg border flex flex-col justify-between shadow-inner relative transition-colors ${mathCore.hasMinNotionalError ? 'from-red-950/40 to-[#0a0a0c] border-red-900/50' : mathCore.isSizeForcedByExchange ? 'from-amber-950/30 to-[#0a0a0c] border-amber-900/50' : 'from-slate-900 to-[#0a0a0c] border-slate-800'}`}>
          <div className="absolute top-2 right-2 text-[8px] text-slate-600 font-bold border border-slate-800 px-1.5 py-0.5 rounded uppercase">Định Cỡ Vị Thế</div>
          
          {/* GIAO DIỆN HIỂN THỊ TÊN CHIẾN THUẬT */}
          <div className="mt-2 mb-1 flex items-center justify-between border-b border-slate-800 pb-2">
             <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                 <Target className="w-3.5 h-3.5 text-blue-500" /> CHIẾN THUẬT AUTO:
             </span>
             <span className={`text-[10px] font-black px-2 py-0.5 rounded border animate-pulse shadow-lg
                 ${tradeSetup.activeStrategy?.includes('X10') ? 'bg-pink-900/30 text-pink-400 border-pink-500/50' 
                 : tradeSetup.activeStrategy?.includes('X5') ? 'bg-amber-900/30 text-amber-400 border-amber-500/50'
                 : tradeSetup.activeStrategy?.includes('X3') ? 'bg-cyan-900/30 text-cyan-400 border-cyan-500/50'
                 : 'bg-slate-900 text-slate-400 border-slate-700'}`}>
                 {tradeSetup.activeStrategy || "TIÊU CHUẨN"}
             </span>
          </div>

          <div className="space-y-3 mt-2">
            <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
              <span className="text-[10px] font-bold text-slate-500">Khối lượng (Size USD):</span>
              <span className={`font-mono text-xs font-black ${mathCore.hasMinNotionalError ? 'text-red-500 animate-pulse' : mathCore.isSizeForcedByExchange ? 'text-amber-400' : 'text-white'}`}>
                ${mathCore?.positionSizeUSD || '0.00'}
              </span>
            </div>
            
            {mathCore.hasMinNotionalError && (
              <div className="text-[8px] text-red-500 font-bold text-right -mt-2">⚠️ LỖI: SIZE BỊ ÉP VƯỢT RỦI RO SINH TỒN ({'>'} 5% VỐN)</div>
            )}
            
            {!mathCore.hasMinNotionalError && mathCore.isSizeForcedByExchange && (
              <div className="text-[8px] text-amber-500 font-bold text-right -mt-2">⚠️ CẢNH BÁO: SIZE ĐÃ BỊ ÉP LÊN MỨC TỐI THIỂU CỦA SÀN KỲ HẠN</div>
            )}

            <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
              <span className="text-[10px] font-bold text-slate-500">Mất ròng tối đa (Risk):</span>
              <span className={`font-black text-sm ${mathCore.isSizeForcedByExchange ? 'text-amber-500' : 'text-red-400'}`}>
                ${mathCore?.riskAmountUSD || '0.00'}
                <span className="text-[8.5px] ml-1.5 text-purple-400 font-normal border border-purple-500/30 bg-purple-900/20 px-1 rounded">
                  APPLIED: {mathCore.appliedRiskPercent}%
                </span>
              </span>
            </div>
            <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
              <span className="text-[10px] font-bold text-slate-500 flex flex-col">
                <span>R:R Ròng (Trừ Ma sát)</span>
                <span className="text-[7.5px] text-purple-400">TRUE EV: {mathCore?.trueEVValue}R</span>
              </span>
              <span className={`font-black text-sm ${parseFloat(mathCore?.theoreticalRR || 0) >= 1.2 ? 'text-emerald-400' : 'text-amber-500'}`}>1 : {mathCore?.theoreticalRR || '0.00'}</span>
            </div>
            
            <div className="flex justify-between items-center bg-slate-950 p-2 rounded border border-slate-800 mt-2">
              <div className="flex flex-col gap-1">
                <span className="text-[8px] text-slate-500 uppercase font-bold flex items-center gap-1"><BarChart3 className="w-3 h-3 text-cyan-500"/> EV Kelly (Bayesian):</span>
                {tradeStats.hasEnoughData ? (
                  <span className={`text-[11px] font-black ${mathCore?.kellyPct > 0 ? 'text-cyan-400' : 'text-red-400'}`}>{mathCore?.kellyPct > 0 ? `+${mathCore?.kellyPct}% VỐN` : 'ÂM ĐỘNG LỰC'}</span>
                ) : (
                  <span className="text-[9px] text-amber-500 flex items-center gap-1"><Lock className="w-2.5 h-2.5"/> SURVIVAL ({mathCore.kellyPct}%)</span>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                 <span className="text-[8px] text-slate-500 uppercase font-bold text-amber-500">Gợi ý Đòn bẩy (An toàn):</span>
                 <span className={`px-2 py-0.5 rounded text-[10px] font-black bg-amber-500/10 text-amber-400 border border-amber-500/20`}>
                   {tradeSetup.tradeType === 'SPOT' ? '1x' : `Min ${mathCore?.suggestedLeverage || '1'}x`}
                 </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

=========================================
/// FILE: src\components\terminal\TradeJournal.jsx
=========================================

// File: src/components/terminal/TradeJournal.jsx
import React, { useMemo } from 'react';
import { History, RefreshCw, CheckCircle2, XCircle, TrendingUp, TrendingDown, Clock, Link, AlertTriangle, Trash2, Calculator } from 'lucide-react';
import { supabase } from '../../services/supabase';

export default function TradeJournal({ tradeLogs, currentPrice, syncBinanceToSupabase, isSyncing, binancePositions }) {
  
  const activeLogSymbols = tradeLogs.filter(l => l.status === 'OPEN' || l.status === 'PENDING').map(l => l.symbol);
  const ghostPositions = binancePositions.filter(p => !activeLogSymbols.includes(p.symbol) && parseFloat(p.positionAmt) !== 0);

  const { sortedLogs, totalRealized, totalFloating, netTotalPnL } = useMemo(() => {
    let realized = 0;
    let floating = 0;

    tradeLogs.forEach(log => {
      if (log.status === 'WIN' || log.status === 'LOSS') {
        realized += parseFloat(log.pnl_usd || 0);
      }
      if (log.status === 'OPEN' || log.status === 'PENDING') {
        const actualPos = binancePositions.find(p => p.symbol === log.symbol);
        if (actualPos) {
          floating += parseFloat(actualPos.unRealizedProfit || 0);
        }
      }
    });

    const priority = { 'OPEN': 1, 'PENDING': 2, 'WIN': 3, 'LOSS': 4 };
    
    const sorted = [...tradeLogs].sort((a, b) => {
      const pA = priority[a.status] || 99;
      const pB = priority[b.status] || 99;
      if (pA !== pB) return pA - pB;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    return { 
      sortedLogs: sorted, 
      totalRealized: realized, 
      totalFloating: floating, 
      netTotalPnL: realized + floating 
    };
  }, [tradeLogs, binancePositions]);

  // 3. HÀM XÓA LỆNH ĐƯỢC BẢO VỆ (CHỈ BẮN TỈA LỆNH ĐÍCH DANH)
  const handleDeleteLog = async (log) => {
    // CHẶN: Đang vào vị thế thực thì KHÔNG ĐƯỢC XÓA BẤT CHẤP
    if (log.status === 'OPEN') {
        alert(`⛔ KHÔNG THỂ XÓA: Lệnh ${log.symbol} đang chạy thực tế trên sàn. Bạn phải ĐÓNG VỊ THẾ (Close Position) trên app Binance trước!`);
        return;
    }

    const isConfirmed = window.confirm(`CẢNH BÁO: Xóa sổ tay lệnh ${log.symbol} [Trạng thái: ${log.status}]?`);
    if (!isConfirmed) return;

    try {
      if (log.status === 'PENDING') {
        // Gửi lệnh Cancel tới Local Bridge kèm theo các mốc giá để nhắm bắn chính xác
        const LOCAL_BRIDGE_URL = 'http://localhost:1337/api/cancel-smart';
        const cancelRes = await fetch(LOCAL_BRIDGE_URL, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              symbol: log.symbol,
              entry: log.entry,
              sl: log.sl,
              tp: log.tp_1_price
            })
        });
        
        const cancelData = await cancelRes.json();
        if (!cancelRes.ok) {
           throw new Error(cancelData.details?.msg || cancelData.error || "Lỗi Bridge Cục bộ");
        }
        console.log(cancelData.message);
      }

      // Xóa ở Supabase khi các lệnh con trên Binance đã bị gỡ bỏ an toàn
      const { error } = await supabase.from('trade_logs').delete().eq('id', log.id);
      if (error) throw error;
      
    } catch (err) {
      alert("Lỗi khi hủy/xóa lệnh: " + err.message);
    }
  };
  
  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl mt-6">
      
      <div className="flex justify-between items-center mb-4 border-b border-slate-800/80 pb-3">
        <h2 className="text-[12px] font-black text-slate-300 uppercase flex items-center gap-2 tracking-widest">
          <History className="w-4 h-4 text-purple-500" /> SỔ TAY LƯỢNG TỬ (SUPABASE)
        </h2>
        <button 
          onClick={syncBinanceToSupabase}
          disabled={isSyncing}
          className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/30 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-2 transition-all"
        >
          <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} /> 
          {isSyncing ? 'ĐANG ĐỒNG BỘ...' : 'ĐỒNG BỘ AUTO-SYNC'}
        </button>
      </div>

      <div className="flex gap-4 mb-4 text-[10px] font-mono bg-[#0a0a0c] p-3 rounded-lg border border-slate-800 shadow-inner">
        <div className="flex flex-col flex-1">
          <span className="text-slate-500 font-bold mb-1 flex items-center gap-1"><Calculator className="w-3 h-3"/> REALIZED (ĐÃ CHỐT)</span>
          <span className={`font-black text-sm ${totalRealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalRealized >= 0 ? '+' : ''}{totalRealized.toFixed(2)}$
          </span>
        </div>
        <div className="flex flex-col flex-1 border-l border-slate-800 pl-4">
          <span className="text-slate-500 font-bold mb-1">FLOATING (ĐANG CHẠY)</span>
          <span className={`font-black text-sm ${totalFloating >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalFloating >= 0 ? '+' : ''}{totalFloating.toFixed(2)}$
          </span>
        </div>
        <div className="flex flex-col flex-1 border-l border-slate-800 pl-4 bg-purple-900/10 rounded-r-lg -my-3 -mr-3 p-3">
          <span className="text-purple-400 font-bold mb-1 uppercase tracking-widest">Net Total PnL</span>
          <span className={`font-black text-lg ${netTotalPnL >= 0 ? 'text-emerald-500' : 'text-red-500'} drop-shadow-md`}>
            {netTotalPnL >= 0 ? '+' : ''}{netTotalPnL.toFixed(2)}$
          </span>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[400px]" style={{ scrollbarWidth: 'thin', scrollbarColor: '#065f46 #0a0a0c' }}>
        <table className="w-full text-left border-collapse relative">
          <thead className="sticky top-0 bg-[#111116] z-10 shadow-md">
            <tr className="text-[9px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
              <th className="pb-2 pt-2">Trạng thái</th>
              <th className="pb-2 pt-2">Cặp / Hướng</th>
              <th className="pb-2 pt-2">Entry / SL / TP</th>
              <th className="pb-2 pt-2 text-right">PnL</th>
              <th className="pb-2 pt-2 text-center w-8">Xóa</th>
            </tr>
          </thead>
          <tbody className="text-[10px] font-mono">
            
            {ghostPositions.map(pos => {
              const isLong = parseFloat(pos.positionAmt) > 0;
              const pnl = parseFloat(pos.unRealizedProfit);
              return (
                  <tr key={`ghost-${pos.symbol}`} className="border-b border-amber-900/50 bg-amber-950/10 hover:bg-amber-900/30">
                      <td className="py-2.5 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                          <span className="font-bold text-amber-500">GHOST</span>
                      </td>
                      <td className="py-2.5">
                          <div className="font-black text-white">{pos.symbol}</div>
                          <div className={`flex items-center gap-1 text-[9px] ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                              {isLong ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>} {isLong ? 'LONG' : 'SHORT'}
                          </div>
                      </td>
                      <td className="py-2.5 text-slate-400">
                          E: <span className="text-white">${parseFloat(pos.entryPrice).toFixed(4)}</span><br/>
                          <span className="text-[8px] text-amber-500 italic">⚠️ Lệnh chưa lưu DB</span>
                      </td>
                      <td className={`py-2.5 text-right font-black ${pnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}$
                      </td>
                      <td className="py-2.5 text-center text-slate-600">-</td>
                  </tr>
              );
            })}

            {sortedLogs.length === 0 && ghostPositions.length === 0 ? (
              <tr><td colSpan="5" className="text-center py-6 text-slate-600 font-bold">KHÔNG CÓ DỮ LIỆU GIAO DỊCH</td></tr>
            ) : (
              sortedLogs.slice(0, 30).map((log) => {
                let isLive = log.status === 'OPEN';
                let isPending = log.status === 'PENDING';
                let displayPnl = parseFloat(log.pnl_usd || 0);
                let displayEntry = parseFloat(log.entry || 0);

                if (isLive || isPending) {
                   const actualPos = binancePositions.find(p => p.symbol === log.symbol);
                   if (actualPos) {
                      displayPnl = parseFloat(actualPos.unRealizedProfit);
                      displayEntry = parseFloat(actualPos.entryPrice);
                      isLive = true; 
                      isPending = false;
                   }
                }

                return (
                  <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-900/50 transition-colors group">
                    <td className="py-2.5 flex items-center gap-1.5">
                      {isPending ? <Link className="w-3.5 h-3.5 text-blue-400 animate-pulse" /> : 
                       isLive ? <Clock className="w-3.5 h-3.5 text-amber-500 animate-spin-slow" /> : 
                       displayPnl > 0 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : 
                       <XCircle className="w-3.5 h-3.5 text-red-500" />}
                      <span className={`font-bold ${isPending ? 'text-blue-400' : isLive ? 'text-amber-500' : displayPnl > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {isPending ? 'CHỜ KHỚP' : log.status}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div className="font-black text-white">{log.symbol}</div>
                      <div className={`flex items-center gap-1 text-[9px] ${log.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {log.direction === 'LONG' ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>} {log.direction}
                      </div>
                    </td>
                    <td className="py-2.5 text-slate-400">
                      E: <span className="text-white">${displayEntry.toFixed(4)}</span><br/>
                      <span className="text-red-400">S: ${parseFloat(log.sl).toFixed(4)}</span> <span className="text-slate-600">|</span> <span className="text-emerald-400">T: ${parseFloat(log.tp_1_price).toFixed(4)}</span>
                    </td>
                    <td className={`py-2.5 text-right font-black ${isPending ? 'text-slate-500' : displayPnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isPending ? '0.00$' : `${displayPnl > 0 ? '+' : ''}${displayPnl.toFixed(2)}$`}
                      {isLive && <div className="text-[8px] text-slate-500 font-normal mt-0.5">(Live)</div>}
                    </td>
                    <td className="py-2.5 text-center">
                      <button 
                        onClick={() => handleDeleteLog(log)} // ĐÃ FIX: TRUYỀN TOÀN BỘ OBJECT LOG
                        className="text-slate-600 hover:text-red-500 hover:bg-red-950/30 p-1.5 rounded transition-all opacity-20 group-hover:opacity-100"
                        title="Xóa lệnh này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

=========================================
/// FILE: src\components\terminal\VectorState.jsx
=========================================

import React from 'react';
import { Activity } from 'lucide-react';

export default function VectorState({ vectorRegime, mvrvZScore, autoData }) {
  if (!vectorRegime || !autoData) return null;

  return (
    <div className="bg-[#111116] border border-purple-900/40 rounded-xl p-4 shadow-xl mb-6 relative overflow-hidden">
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-900/10 rounded-full blur-xl"></div>
      <div className="flex justify-between items-end border-b border-purple-900/30 pb-2 mb-4">
        <h2 className="text-[10px] font-black text-purple-400 uppercase tracking-widest flex items-center gap-2">
          <Activity className="w-4 h-4" /> VECTOR STATE SPACE (V6.1)
        </h2>
        <div className="text-[9px] text-slate-500 font-mono">
          <span className="text-purple-500 font-bold">MVRV-Z:</span> {mvrvZScore} ({vectorRegime.details.mvrvDesc})
        </div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 font-mono">
        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L1: Structure</span>
          <span className={`text-[10px] font-black uppercase ${vectorRegime.details.l1.includes('Trend') ? 'text-emerald-400' : 'text-amber-400'}`}>
            {vectorRegime.details.l1}
          </span>
        </div>

        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L2: Volatility</span>
          <span className={`text-[10px] font-black uppercase ${vectorRegime.details.l2 === 'Compression' ? 'text-pink-500 animate-pulse' : vectorRegime.details.l2 === 'Extreme' ? 'text-red-500' : 'text-blue-400'}`}>
            {vectorRegime.details.l2}
          </span>
        </div>

        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L3: Liq Event</span>
          <span className={`text-[9px] font-black uppercase ${vectorRegime.details.l3 !== 'Quiet' ? 'text-red-400 font-bold' : 'text-slate-400'}`}>
            {vectorRegime.details.l3}
          </span>
        </div>

        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L4: Positioning (OI)</span>
          <span className={`text-[9px] font-black uppercase ${vectorRegime.details.l4.includes('Smart') ? 'text-amber-300' : vectorRegime.details.l4.includes('Building') ? 'text-cyan-400' : vectorRegime.details.l4.includes('Liquidation') || vectorRegime.details.l4.includes('Capitulation') ? 'text-red-500' : 'text-slate-300'}`}>
            {vectorRegime.details.l4}
          </span>
        </div>

        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L5: Momentum</span>
          <span className={`text-[9px] font-black uppercase ${vectorRegime.details.l5.includes('Fake') || vectorRegime.details.l5.includes('Divergence') ? 'text-red-500 animate-pulse' : 'text-emerald-400'}`}>
            {vectorRegime.details.l5}
          </span>
        </div>

        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L6: Macro Status</span>
          <span className={`text-[9px] font-black uppercase ${vectorRegime.details.l6.includes('Overvaluation') ? 'text-red-500' : vectorRegime.details.l6.includes('Bleeding') ? 'text-amber-500' : 'text-emerald-500'}`}>
            {vectorRegime.details.l6}
          </span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-purple-900/30 text-center font-mono relative">
         <div className="absolute left-0 top-3 text-[7px] text-purple-400 rotate-[-90deg] uppercase tracking-widest opacity-50">Range Scan</div>
         <div className="grid grid-cols-5 gap-2 pl-4">
            <div className="flex flex-col"><span className="text-[7px] text-slate-500">EMA 20 SLOPE</span><span className={`text-[10px] font-bold ${autoData.ema20.slope > 0 ? 'text-emerald-500' : 'text-red-500'}`}>{autoData.ema20.slope.toFixed(2)}%</span></div>
            <div className="flex flex-col"><span className="text-[7px] text-slate-500">EMA 50 SLOPE</span><span className={`text-[10px] font-bold ${autoData.ema50.slope > 0 ? 'text-emerald-500' : 'text-red-500'}`}>{autoData.ema50.slope.toFixed(2)}%</span></div>
            <div className="flex flex-col"><span className="text-[7px] text-slate-500">EMA 200 SLOPE</span><span className={`text-[10px] font-bold ${autoData.ema200.slope > 0 ? 'text-emerald-500' : 'text-red-500'}`}>{autoData.ema200.slope.toFixed(2)}%</span></div>
            
            <div className={`col-span-2 flex flex-col items-center justify-center rounded border ${autoData.scan20_50.isCrossBull ? 'bg-emerald-950/30 border-emerald-500/50' : autoData.scan20_50.isCrossBear ? 'bg-red-950/30 border-red-500/50' : 'bg-black/30 border-slate-800'}`}>
               <span className="text-[7px] text-slate-500 uppercase">20/50 Crossover (20 Nến)</span>
               <span className={`text-[10px] font-black ${autoData.scan20_50.isCrossBull ? 'text-emerald-400' : autoData.scan20_50.isCrossBear ? 'text-red-400' : 'text-slate-600'}`}>
                  {autoData.scan20_50.isCrossBull ? '🟢 GOLDEN CROSS' : autoData.scan20_50.isCrossBear ? '🔴 DEATH CROSS' : `NO CROSS (Spread: ${autoData.scan20_50.spreadPercent.toFixed(2)}%)`}
               </span>
            </div>
         </div>
      </div>
    </div>
  );
}

=========================================
/// FILE: src\config\constants.js
=========================================

// File: src/config/constants.js

export const MIN_NOTIONALS = {
  BTCUSDT: 50, 
  ETHUSDT: 20, 
  SOLUSDT: 5, 
  BNBUSDT: 5,   
  LINKUSDT: 20, 
  XRPUSDT: 5, 
  ADAUSDT: 5, 
  DASHUSDT: 5,  
  AVAXUSDT: 5   
};

export const getMinNotional = (sym) => MIN_NOTIONALS[sym] || 10;

export const POOL_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 
  'LINKUSDT', 'XRPUSDT', 'ADAUSDT', 'DASHUSDT', 'AVAXUSDT'
];

export const POOL_INTERVALS = ['5m', '15m', '1h', '4h', '1d'];

=========================================
/// FILE: src\core\QuantMath.js
=========================================

// FILE: src/core/QuantMath.js

const QuantMath = {
  sma: (data, period) => {
    if (!data || data.length < period || period <= 0) return 0;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  },
  
  ema: (data, period) => {
    if (!data || data.length < period || period <= 0) return 0;
    const k = 2 / (period + 1);
    let emaVal = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      emaVal = (data[i] * k) + (emaVal * (1 - k));
    }
    return emaVal;
  },
  
  trueRange: (h, l, pc) => Math.max(h - l || 0, Math.abs(h - pc) || 0, Math.abs(l - pc) || 0),
  
  atr: (highs, lows, closes, period) => {
    if (!closes || closes.length < period + 1 || highs.length !== closes.length) return 0;
    let trs = [];
    for (let i = 1; i < closes.length; i++) {
      trs.push(QuantMath.trueRange(highs[i], lows[i], closes[i-1]));
    }
    let currentAtr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      currentAtr = ((currentAtr * (period - 1)) + trs[i]) / period; 
    }
    return currentAtr || 0;
  },
  
  adx: (highs, lows, closes, period = 14) => {
    if (!closes || closes.length < period * 2) return 0;
    let trs = [], plusDMs = [], minusDMs = [];
    for (let i = 1; i < closes.length; i++) {
      trs.push(QuantMath.trueRange(highs[i], lows[i], closes[i-1]));
      const upMove = highs[i] - highs[i-1];
      const downMove = lows[i-1] - lows[i];
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    let smoothedTR = trs.slice(0, period).reduce((a,b)=>a+b,0);
    let smoothedPlusDM = plusDMs.slice(0, period).reduce((a,b)=>a+b,0);
    let smoothedMinusDM = minusDMs.slice(0, period).reduce((a,b)=>a+b,0);
    
    let dxs = [];
    for (let i = period; i < trs.length; i++) {
      smoothedTR = smoothedTR - (smoothedTR/period) + trs[i];
      smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM/period) + plusDMs[i];
      smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM/period) + minusDMs[i];
      const plusDI = 100 * (smoothedPlusDM / smoothedTR);
      const minusDI = 100 * (smoothedMinusDM / smoothedTR);
      const dx = 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1);
      dxs.push(dx || 0);
    }
    
    let adx = dxs.slice(0, period).reduce((a,b)=>a+b,0) / period;
    for (let i = period; i < dxs.length; i++) {
      adx = ((adx * (period - 1)) + dxs[i]) / period; 
    }
    return adx || 0;
  },
  
  rsi: (closes, period = 14) => {
    if (!closes || closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i-1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i-1];
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  },
  
  bollinger: (closes, period = 20, stdDev = 2) => {
    if (!closes || closes.length < period) return { bbw: 0, upper: 0, lower: 0, sma: 0 };
    const slice = closes.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
    const dev = Math.sqrt(variance);
    const upper = sma + (stdDev * dev);
    const lower = sma - (stdDev * dev);
    const bbw = ((upper - lower) / sma) * 100; 
    return { bbw, upper, lower, sma };
  },

  percentileRank: (currentValue, historicalArray) => {
    if (!historicalArray || historicalArray.length === 0) return 50;
    const belowCount = historicalArray.filter(val => val < currentValue).length;
    return (belowCount / historicalArray.length) * 100;
  },
  
  obv: (closes, volumes) => { 
    if (!closes || closes.length < 2) return 0;
    let obv = 0;
    for (let j = 1; j < closes.length; j++) {
      if (closes[j] > closes[j-1]) obv += volumes[j];
      else if (closes[j] < closes[j-1]) obv -= volumes[j];
    }
    return obv;
  },

  cmf: (highs, lows, closes, volumes, period = 20) => { 
    if (!closes || closes.length < period) return 0;
    let mfValues = [];
    for (let j = 0; j < closes.length; j++) {
      const clv = ((closes[j] - lows[j]) - (highs[j] - closes[j])) / (highs[j] - lows[j] || 1);
      mfValues.push(clv * volumes[j]);
    }
    const recentMfSum = mfValues.slice(-period).reduce((a, b) => a + b, 0);
    const recentVolSum = volumes.slice(-period).reduce((a, b) => a + b, 0);
    return recentMfSum / (recentVolSum || 1);
  },
  
  costDrag: (entryPrice, tradeType, direction, entryExecution, exitExecution, fundingRate, spreadPercent, holdingCycles = 1, makerFee = 0.0002, takerFee = 0.0004, interval = '1h', obi = 0.5) => { 
    let slippagePenalty = 0;
    if (entryExecution === 'MARKET') {
        if (direction === 'LONG' && obi < 0.4) slippagePenalty = 0.0015; 
        if (direction === 'SHORT' && obi > 0.6) slippagePenalty = 0.0015; 
    }
    const entrySlippage = entryExecution === 'MARKET' ? (0.001 + slippagePenalty) : 0; 
    const entryFee = entryExecution === 'MARKET' ? takerFee : makerFee;
    
    const exitSlippage = exitExecution === 'MARKET' ? 0.001 : 0; 
    const exitFee = exitExecution === 'MARKET' ? takerFee : makerFee;

    const spreadCost = (spreadPercent / 100) / 2;
    
    const intervalToHours = { '5m': 5/60, '15m': 15/60, '1h': 1, '4h': 4, '1d': 24 }; 
    const hoursPerCandle = intervalToHours[interval] || 1;
    const totalHoldingHours = holdingCycles * hoursPerCandle;
    const realFundingCycles = totalHoldingHours / 8; 
    
    let fundingImpact = 0;
    if (tradeType === 'FUTURES') {
       if (direction === 'LONG') {
           fundingImpact = fundingRate * realFundingCycles; 
       } else {
           fundingImpact = -fundingRate * realFundingCycles; 
       }
    }
    
    const entryCostPerCoin = (entrySlippage + entryFee + spreadCost) * entryPrice;
    const exitCostPerCoin = (exitSlippage + exitFee + spreadCost) * entryPrice;

    return entryCostPerCoin + exitCostPerCoin + (fundingImpact * entryPrice); 
  },

  trueEV: (winRate, reward, lossRate, risk) => {
     return (winRate * reward) - (lossRate * risk);
  },
  
  kellyCriterion: (winRate, historicalAvgRR, nTrades = 0) => {
    if (nTrades < 5) return 0.02; 
    if(winRate === 0 || historicalAvgRR === 0) return 0.01; 
    
    const fullKelly = winRate - ((1 - winRate) / historicalAvgRR);
    let halfKelly = Math.max(0, fullKelly * 0.5); 
    if (nTrades < 30) {
      const penalty = Math.max(0.15, nTrades / 30); 
      halfKelly = halfKelly * penalty;
    }
    return halfKelly;
  },

  scanEmaRange: (closesArray, fastPeriod, slowPeriod, lookback = 20, atrValue = 0) => {
      if (!closesArray || closesArray.length < Math.max(fastPeriod, slowPeriod) + lookback) {
         return { fastEmaCurrent: 0, slowEmaCurrent: 0, fastSlope: 0, slowSlope: 0, isCrossBull: false, isCrossBear: false, spreadPercent: 0, normFastSlope: 0, normSlowSlope: 0 };
      }
      const fastEmaCurrent = QuantMath.ema(closesArray, fastPeriod);
      const slowEmaCurrent = QuantMath.ema(closesArray, slowPeriod);
      
      const pastCloses = closesArray.slice(0, -lookback);
      const fastEmaPast = QuantMath.ema(pastCloses, fastPeriod);
      const slowEmaPast = QuantMath.ema(pastCloses, slowPeriod);

      const fastSlope = fastEmaPast > 0 ? ((fastEmaCurrent - fastEmaPast) / fastEmaPast) * 100 : 0;
      const slowSlope = slowEmaPast > 0 ? ((slowEmaCurrent - slowEmaPast) / slowEmaPast) * 100 : 0;
      
      const normFastSlope = (atrValue > 0 && fastEmaPast > 0) ? (fastEmaCurrent - fastEmaPast) / atrValue : fastSlope;
      const normSlowSlope = (atrValue > 0 && slowEmaPast > 0) ? (slowEmaCurrent - slowEmaPast) / atrValue : slowSlope;

      const isCrossBull = (fastEmaPast < slowEmaPast) && (fastEmaCurrent > slowEmaCurrent);
      const isCrossBear = (fastEmaPast > slowEmaPast) && (fastEmaCurrent < slowEmaCurrent);
      
      const spreadPercent = slowEmaCurrent > 0 ? Math.abs(fastEmaCurrent - slowEmaCurrent) / slowEmaCurrent * 100 : 0;

      return { fastEmaCurrent, slowEmaCurrent, fastSlope, slowSlope, isCrossBull, isCrossBear, spreadPercent, normFastSlope, normSlowSlope };
  },
  
  detectSFP_Advanced: (highs, lows, closes, volumes, avgVolume, direction) => {
    if (!closes || closes.length < 10 || !volumes) return false;
    const triggerIndex = closes.length - 2; 
    const triggerClose = closes[triggerIndex];
    const triggerHigh = highs[triggerIndex];
    const triggerLow = lows[triggerIndex];
    const triggerVol = volumes[triggerIndex];

    if (triggerVol < avgVolume * 1.2) return false;

    let lastPivotHigh = -1;
    let lastPivotLow = Infinity;

    for (let j = triggerIndex - 3; j >= 2; j--) {
        if (highs[j] > highs[j-1] && highs[j] > highs[j-2] && 
            highs[j] > highs[j+1] && highs[j] > highs[j+2]) {
            lastPivotHigh = highs[j];
            break; 
        }
    }

    for (let j = triggerIndex - 3; j >= 2; j--) {
        if (lows[j] < lows[j-1] && lows[j] < lows[j-2] && 
            lows[j] < lows[j+1] && lows[j] < lows[j+2]) {
            lastPivotLow = lows[j];
            break;
        }
    }

    if (direction === 'SHORT') {
        return (lastPivotHigh !== -1 && triggerHigh > lastPivotHigh && triggerClose < lastPivotHigh);
    } else {
        return (lastPivotLow !== Infinity && triggerLow < lastPivotLow && triggerClose > lastPivotLow);
    }
  },

  dynamicAsymmetricTargets: (bbwRank, bbwSlope, isSfp, atrPercent, obi, direction) => {
      // VÁ LỖI TOÁN HỌC: Adaptive RR Base để không bao giờ rớt isRRSafe trong Scanner
      const requiredRR = bbwRank > 80 ? 2.0 : 1.8;
      let slMult = 1.5; 
      let tpMult = slMult * (requiredRR + 0.3); // Tự động nới TP xa ra để đền bù phí giao dịch
      let strategyName = "TIÊU CHUẨN (ADAPTIVE)";

      const noiseBuffer = atrPercent > 2.0 ? 0.2 : 0;

      if (bbwRank <= 15 && bbwSlope > 10) {
          tpMult = 7.0; 
          slMult = 1.0 + noiseBuffer; 
          strategyName = "🚀 X10 SQUEEZE BREAKOUT";
      }
      else if (isSfp) {
          if ((direction === 'LONG' && obi > 0.70) || (direction === 'SHORT' && obi < 0.30)) {
              tpMult = 4.0; 
              slMult = 0.6 + (noiseBuffer / 2); 
              strategyName = "🎯 X5 SNIPER SFP";
          }
      }
      else if (obi > 0.85 || obi < 0.15) {
          tpMult = 3.0;
          slMult = 1.2 + noiseBuffer;
          strategyName = "🐳 WHALE IMBALANCE (X3)";
      }

      return { tpMult, slMult, strategyName };
  },

  estimateLiquidation: (notionalUSD, leverage, entry, direction, brackets) => {
    if (!brackets || brackets.length === 0 || !leverage) return null;
    const tier = brackets.find(b => notionalUSD >= b.notionalFloor && notionalUSD < b.notionalCap) 
                 || brackets[brackets.length - 1]; 
    const mmr = tier.maintMarginRatio;
    const maxLevForTier = tier.initialLeverage; 

    const liqPrice = direction === 'LONG'
      ? entry * (1 - (1 / leverage) + mmr)
      : entry * (1 + (1 / leverage) - mmr);

    return { liqPrice, mmr, maxLevForTier, bracket: tier.bracket };
  }
};

export default QuantMath;

=========================================
/// FILE: src\core\riskModels.js
=========================================



=========================================
/// FILE: src\core\TradeValidator.js
=========================================

/// FILE: src/core/TradeValidator.js

export const TradeValidator = {
  // 1. HỆ THỐNG CHẤM ĐIỂM (SCORING & PENALTY ENGINE)
  evaluateScore: (autoData, apiMacro, vectorDetails, direction, mvrvZScore, symbol) => {
    if (!autoData || !apiMacro || !vectorDetails) return { score: 0, synergyText: "", penaltyText: "", checks: {}, w: {} };
    
    const { l1, l2, l6, isAltcoinBleeding, isAltcoinSeason } = vectorDetails;
    let w = { s1: 2.0, s2: 2.0, s3: 1.5, s4: 0.5, s5: 1.0, s6: 1.5, s7: 1.0, s8: 1.5 }; 
    if (l1 === 'Range') { w = { s1: 0, s2: 2.0, s3: 4.0, s4: 1.0, s5: 1.5, s6: 1.0, s7: 1.0, s8: 1.0 }; } 
    else if (l2 === 'Extreme') { w = { s1: 0, s2: 1.5, s3: 3.5, s4: 1.0, s5: 1.5, s6: 2.0, s7: 1.5, s8: 0.5 }; } 
    else if (l1.includes('Trend') && l2 === 'Expansion') { w = { s1: 3.0, s2: 2.5, s3: 0, s4: 0.5, s5: 1.0, s6: 2.5, s7: 1.0, s8: 2.0 }; }

    const isVolSpikeHUD = autoData.lastClosedVolume > (autoData.avgVolume20 * 2.5);

    const checkS1 = direction === (l1 === 'Trend Up' ? 'LONG' : 'SHORT');
    const checkS2 = direction === 'LONG' ? autoData.cmf > 0.05 : autoData.cmf < -0.05;
    const checkS3 = direction === 'LONG' ? autoData.isBullishSFP : autoData.isBearishSFP;
    const checkS4 = direction === 'LONG' ? (l1.includes('Trend') ? autoData.rsi < 65 : autoData.rsi < 40) : (l1.includes('Trend') ? autoData.rsi > 35 : autoData.rsi > 60); 
    const checkS5 = direction === 'LONG' ? apiMacro.longShortRatio < 1.0 : apiMacro.longShortRatio > 1.0; 
    const checkS6 = direction === 'LONG' ? (apiMacro.takerBuySellRatio > 1.05 && !autoData.isObvBearDivergence) : (apiMacro.takerBuySellRatio < 0.95 && !autoData.isObvBullDivergence);
    const checkS7 = direction === 'LONG' ? (autoData.fundingRate < 0 && isVolSpikeHUD) : (autoData.fundingRate > 0 && isVolSpikeHUD);
    const checkS8 = direction === 'LONG' ? (autoData.currentPrice > autoData.htfSma200 && autoData.ema200.slope > 0) : (autoData.currentPrice < autoData.htfSma200 && autoData.ema200.slope < 0);

    let score = 0; 
    if (checkS1) score += w.s1; if (checkS2) score += w.s2; if (checkS3) score += w.s3; if (checkS4) score += w.s4; 
    if (checkS5) score += w.s5; if (checkS6) score += w.s6; if (checkS7) score += w.s7; if (checkS8) score += w.s8;

    let synergyText = "";
    if (l2 === 'Compression' && checkS2 && checkS6) { score += 2.0; synergyText += "[💣 The Spring] "; }
    if (l2 === 'Extreme' && checkS3 && checkS4) { score += 2.0; synergyText += "[🩸 Capitulation Sweep] "; }
    if (isVolSpikeHUD && !checkS5 && checkS6) { score += 1.5; synergyText += "[🪤 Smart Money Trap] "; }
    if (direction === 'LONG' && isAltcoinSeason) { score += 1.0; synergyText += "[🌊 Altcoin Season] "; }

    const isTripleTrendBull = autoData.ema20.slope > 0 && autoData.ema50.slope > 0 && autoData.ema200.slope > 0;
    const isTripleTrendBear = autoData.ema20.slope < 0 && autoData.ema50.slope < 0 && autoData.ema200.slope < 0;
    if ((direction === 'LONG' && isTripleTrendBull) || (direction === 'SHORT' && isTripleTrendBear)) { score += 1.5; synergyText += "[🚅 Triple-Engine] "; }
    if (autoData.adx > 35 && checkS6) { score += 1.5; synergyText += "[🌪️ ADX Squeeze] "; }
    if ((direction === 'LONG' && mvrvZScore < 1.0 && checkS3) || (direction === 'SHORT' && mvrvZScore > 2.5 && checkS3)) { score += 1.5; synergyText += "[💎 Deep Value Sweep] "; }
    if (l2 === 'Compression' && autoData.bbwSlope > 10) { score += 2.0; synergyText += "[🧨 Vol Expansion] "; }
    if (l2 === 'Compression' && ((direction === 'LONG' && autoData.obi > 0.7 && checkS6) || (direction === 'SHORT' && autoData.obi < 0.3 && checkS6))) { score += 2.0; synergyText += "[🐳 Whale Accumulation] "; }

    let penaltyText = "";
    if (direction === 'LONG' && isAltcoinBleeding) { score -= 2.0; penaltyText += "[-2.0 Altcoins Bleeding] "; }
    if (direction === 'LONG' && l6.includes('Overvaluation')) { score -= 1.5; penaltyText += "[-1.5 MVRV Overvalue] "; }
    if (direction === 'SHORT' && l6.includes('Undervaluation')) { score -= 1.5; penaltyText += "[-1.5 MVRV Undervalue] "; }
    
    // NÂNG CẤP ADX / NY SESSION
    if (autoData.adx > 55) { score -= 1.5; penaltyText += "[-1.5 ADX Exhaustion] "; }
    if (apiMacro.tradingSession === 'NEW_YORK' && l1.includes('Trend')) { score -= 1.5; penaltyText += "[-1.5 NY Session Trap] "; }

    return { score, synergyText, penaltyText, checks: { checkS1, checkS2, checkS3, checkS4, checkS5, checkS6, checkS7, checkS8 }, w };
  },

  // 2. HỆ THỐNG MÀNG LỌC VÀ OVERRIDES (LOGIC GATES ENGINE)
  evaluateGates: (autoData, apiMacro, vectorDetails, mathCore, direction, tradeType, entry, slTech, systemScore, tradeLogs, symbol) => {
    const { l1, l2, l3 } = vectorDetails;
    const { score, synergyText, penaltyText, checks, w } = systemScore;
    const requiredRR = autoData.bbwRank > 80 ? 2.0 : 1.8;

    // KIỂM TRA TRÍ NHỚ COOLDOWN (Chống nhồi lệnh mù quáng)
    const recentLossSameDirection = tradeLogs && tradeLogs.some(log => 
        log.symbol === symbol && 
        log.direction === direction && 
        log.status === 'LOSS' &&
        (Date.now() - new Date(log.close_time).getTime()) < 2 * 60 * 60 * 1000 
    );

    const hardGates = [
      { id: 'h_cd', passed: !recentLossSameDirection, text: `COOLDOWN: Không nhồi lệnh cùng hướng ${direction} sau khi bị SL trong 2H qua.` },
      { id: 'h1', passed: apiMacro.realSpreadPct < 0.2 && slTech > 0 && Math.abs(entry - slTech) > (autoData.atr14 * 0.5), text: `CHỐNG NHIỄU: Khoảng cách SL > 0.5 ATR` },
      { id: 'h2', passed: parseFloat(mathCore.theoreticalRR) >= requiredRR, text: `KỲ VỌNG EV: R:R ròng >= ${requiredRR}` },
      { id: 'h3_1', passed: l1 !== 'Transition', text: `REGIME LOCK: Xu hướng rõ ràng` },
      { id: 'h3_2', passed: l2 !== 'Compression', text: `VOLATILITY: Không giao dịch trong vùng Nén` },
      { id: 'h4', passed: tradeType === 'SPOT' || (mathCore.liqEstimate && !mathCore.leverageExceedsExchangeCap && mathCore.liqSafetyMargin >= 1.3), text: `ĐỆM THANH LÝ: An toàn Margin` },
      { id: 'h5', passed: !mathCore.hasMinNotionalError, text: `MIN NOTIONAL: Risk bị ép <= 2.5% Vốn` },
      { id: 'h6', passed: autoData.lastClosedVolume >= (autoData.avgVolume20 * 0.4), text: `VOL DEADZONE: Thanh khoản ổn định` }
    ];

    const softGates = [
      { id: 's1', passed: checks.checkS1, weight: w.s1, text: `CẤU TRÚC L1 (+${w.s1})` },
      { id: 's2', passed: checks.checkS2, weight: w.s2, text: `DÒNG TIỀN CMF (+${w.s2})` },
      { id: 's3', passed: checks.checkS3, weight: w.s3, text: `SĂN THANH KHOẢN (+${w.s3})` },
      { id: 's4', passed: checks.checkS4, weight: w.s4, text: `ĐỘNG LƯỢNG (+${w.s4})` },
      { id: 's5', passed: checks.checkS5, weight: w.s5, text: `TÂM LÝ (+${w.s5})` },
      { id: 's6', passed: checks.checkS6, weight: w.s6, text: `ORDER FLOW (+${w.s6})` },
      { id: 's7', passed: checks.checkS7, weight: w.s7, text: `SQUEEZE (+${w.s7})` },
      { id: 's8', passed: checks.checkS8, weight: w.s8, text: `HỢP LƯU VĨ MÔ (+${w.s8})` }
    ];

    if (synergyText) softGates.push({ id: 's_syn', passed: true, weight: 0, text: `🔥 SYNERGY BONUS: ${synergyText}` });
    if (penaltyText) softGates.push({ id: 's_pen', passed: false, weight: 0, text: `⚠️ MACRO PENALTY: ${penaltyText}` });

    const hardPassed = hardGates.every(g => g.passed);
    const failedGates = hardGates.filter(g => !g.passed);

    // XỬ LÝ CÁC OVERRIDE (BẼ KHÓA GATES)
    const isOnlyRegimeFailed = failedGates.length > 0 && failedGates.every(g => g.id === 'h3_1' || g.id === 'h3_2');
    const isSafeFromKnife = direction === 'LONG' ? (autoData.cmf > 0.15 && autoData.rsi > 35) : (autoData.cmf < -0.15 && autoData.rsi < 65);
    const isGoldenOverride = isOnlyRegimeFailed && (score >= 8.5) && synergyText !== "" && isSafeFromKnife;
    
    const isOnlySLFailed = failedGates.length > 0 && failedGates.every(g => g.id === 'h1');
    const isSniperOverride = isOnlySLFailed && checks.checkS3 && score >= 7.0;

    const isOnlyVolFailed = failedGates.length > 0 && failedGates.every(g => g.id === 'h6');
    const isHighRROverride = isOnlyVolFailed && parseFloat(mathCore.theoreticalRR) >= 2.5 && score >= 7.0;

    const isNanoCapSniper = parseFloat(mathCore.theoreticalRR) >= 2.5 && (l2 === 'Compression' || l3.includes('SFP') || l3.includes('Squeeze Imminent') || (direction === 'LONG' && autoData.obi > 0.7) || (direction === 'SHORT' && autoData.obi < 0.3)) && !mathCore.hasMinNotionalError && score >= 7.0;
    const isNanoOverride = failedGates.length > 0 && failedGates.every(g => g.id === 'h3_1' || g.id === 'h6') && isNanoCapSniper;

    const isApproved = (hardPassed || isGoldenOverride || isSniperOverride || isHighRROverride || isNanoOverride) && (score >= 6.5); 
    
    return { hardGates, softGates, softScore: score, isApproved, isGoldenOverride, isSniperOverride, isHighRROverride, isNanoOverride };
  }
};

=========================================
/// FILE: src\hooks\useAI.js
=========================================



=========================================
/// FILE: src\hooks\useExchangeConfig.js
=========================================

// FILE: src/hooks/useExchangeConfig.js
import { useState, useEffect } from 'react';
import { POOL_SYMBOLS, MIN_NOTIONALS } from '../config/constants';

export default function useExchangeConfig() {
  const [dynamicMinNotionals, setDynamicMinNotionals] = useState(MIN_NOTIONALS);
  const [dynamicPool, setDynamicPool] = useState(POOL_SYMBOLS);
  const [stepSizes, setStepSizes] = useState({});
  const [tickSizes, setTickSizes] = useState({});

  useEffect(() => {
    let isMounted = true;
    const fetchExchangeData = async () => {
      try {
        const ts = Date.now();
        const exRes = await fetch(`/api/binance?path=/fapi/v1/exchangeInfo&t=${ts}`);
        const exData = await exRes.json();

        const tickerRes = await fetch(`/api/binance?path=/fapi/v1/ticker/24hr&t=${ts}`);
        const tickerData = await tickerRes.json();

        if (!isMounted || !exData.symbols || !Array.isArray(tickerData)) return;

        const newNotionals = { ...MIN_NOTIONALS };
        const newStepSizes = {};
        const newTickSizes = {};

        exData.symbols.forEach(sym => {
          const notionalFilter = sym.filters.find(f => f.filterType === 'MIN_NOTIONAL');
          if (notionalFilter) newNotionals[sym.symbol] = parseFloat(notionalFilter.notional || 5);
          
          const lotSize = sym.filters.find(f => f.filterType === 'LOT_SIZE');
          if (lotSize) newStepSizes[sym.symbol] = parseFloat(lotSize.stepSize);
          
          const priceFilter = sym.filters.find(f => f.filterType === 'PRICE_FILTER');
          if (priceFilter) newTickSizes[sym.symbol] = parseFloat(priceFilter.tickSize);
        });

        const validTickers = tickerData
          .filter(t => t.symbol.endsWith('USDT') && !POOL_SYMBOLS.includes(t.symbol) && parseFloat(t.quoteVolume) > 30000000)
          .sort((a, b) => Math.abs(parseFloat(b.priceChangePercent)) - Math.abs(parseFloat(a.priceChangePercent)));
        
        const topVolatileCoins = validTickers.slice(0, 15).map(t => t.symbol);
        const mergedPool = [...new Set([...POOL_SYMBOLS, ...topVolatileCoins])];

        setDynamicMinNotionals(newNotionals);
        setStepSizes(newStepSizes);
        setTickSizes(newTickSizes);
        setDynamicPool(mergedPool);
      } catch (e) {
        console.error("⚠️ Lỗi Đồng bộ Dữ liệu Exchange Info:", e);
      }
    };

    fetchExchangeData();
    const timer = setInterval(fetchExchangeData, 300000); // ĐÃ FIX: 5 Phút cập nhật luân chuyển dòng tiền 1 lần
    return () => { isMounted = false; clearInterval(timer); };
  }, []);

  return { dynamicMinNotionals, dynamicPool, stepSizes, tickSizes };
}

=========================================
/// FILE: src\hooks\useLiveData.js
=========================================

/// FILE: src/hooks/useLiveData.js
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
  const [cmcData, setCmcData] = useState({ btcDominanceRealtime: 55.0, totalMarketCapBillion: 0, fgiClassification: 'NEUTRAL' });

  const [apiMacro, setApiMacro] = useState({
    fgiValue: 50, longShortRatio: 1.0, lsPositionVolRatio: 1.0, takerBuySellRatio: 1.0, 
    tradingSession: 'ASIAN', sessionMultiplier: 0.8, isWeekend: false, realSpreadPct: 0.05 
  });

  const apiMacroRef = useRef(apiMacro);
  useEffect(() => { apiMacroRef.current = apiMacro; }, [apiMacro]);

  useEffect(() => {
    const detectSessionAndWeekend = () => {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const day = now.getUTCDay();
      let currentSession = 'ASIAN'; let mult = 0.8; 
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

  useEffect(() => {
    let isMounted = true;
    const fetchBracketsAndFees = async () => {
      try {
        const ts = Math.floor(Date.now() / 60000); 
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

  // LUỒNG 1: REST API LẤY CHỈ BÁO NẶNG (15S/LẦN) - GIỮ NGUYÊN HOÀN TOÀN LOGIC CỦA BẠN
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

  // LUỒNG 2: WEBSOCKET REAL-TIME TICKER (ĐỘ TRỄ ~100ms) - Cập nhật giá liên tục không dội Vercel
  useEffect(() => {
    let isMounted = true;
    const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@markPrice@1s`;
    const ws = new WebSocket(wsUrl);

    // Kỹ thuật Throttling (Giảm xung): Chỉ cập nhật state nếu giá thay đổi quá 0.05% để tránh re-render rác
    let lastRenderedPrice = 0;

    ws.onmessage = (event) => {
        if (!isMounted) return;
        const data = JSON.parse(event.data);
        if (data.e === 'markPriceUpdate') {
            const newPrice = parseFloat(data.p);
            // Chỉ bắt React re-render nếu giá lệch đủ lớn (ví dụ: > 0.05%) HOẶC chưa có giá
            if (lastRenderedPrice === 0 || Math.abs(newPrice - lastRenderedPrice) / lastRenderedPrice > 0.0005) {
                lastRenderedPrice = newPrice;
                setAutoData(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        currentPrice: newPrice,
                        atrPercent: newPrice > 0 ? (prev.atr14 / newPrice) * 100 : prev.atrPercent
                    };
                });
            }
        }
    };

    ws.onerror = () => { console.log("WebSocket MarkPrice bị lỗi ngắt kết nối."); };

    return () => {
        isMounted = false;
        ws.close();
    };
  }, [symbol]);

  return { loading, lastUpdated, systemError, liveCapital, binancePositions, leverageBrackets, tradeFees, autoData, cmcData, apiMacro };
}

=========================================
/// FILE: src\hooks\useLogicGates.js
=========================================



=========================================
/// FILE: src\hooks\useMatrixScanner.js
=========================================

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

=========================================
/// FILE: src\index.css
=========================================

@tailwind base;
@tailwind components;
@tailwind utilities;

/* Tùy chỉnh thanh cuộn (Scrollbar) cho giao diện ngầu hơn */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: #0a0a0c;
}
::-webkit-scrollbar-thumb {
  background: #065f46;
  border-radius: 3px;
}

=========================================
/// FILE: src\main.jsx
=========================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

=========================================
/// FILE: src\services\binanceAPI.js
=========================================



=========================================
/// FILE: src\services\geminiAPI.js
=========================================



=========================================
/// FILE: src\services\supabase.js
=========================================

// File: src/services/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''; 
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''; 

export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

=========================================
/// FILE: src\store\useAppStore.js
=========================================

// FILE: src/store/useAppStore.js
import { create } from 'zustand';

const useAppStore = create((set) => ({
  // Dữ liệu cài đặt người dùng
  symbol: 'BTCUSDT',
  setSymbol: (sym) => set({ symbol: sym }),
  
  intervalTime: '15m',
  setIntervalTime: (int) => set({ intervalTime: int }),
  
  mvrvZScore: 0.23,
  setMvrvZScore: (z) => set({ mvrvZScore: z }),

  // Cấu hình giao dịch
  tradeSetup: {
    tradeType: 'FUTURES', direction: 'LONG', execution: 'LIMIT', 
    riskPercent: 1.0, entry: 0, slTech: 0, tp1: 0, activeStrategy: "TIÊU CHUẨN" 
  },
  setTradeSetup: (updater) => set((state) => ({ 
    tradeSetup: typeof updater === 'function' ? updater(state.tradeSetup) : { ...state.tradeSetup, ...updater } 
  })),

  // Cấu hình mạng & hệ thống
  systemHealth: { weight: 0, maxWeight: 2400, latency: 0 },
  setSystemHealth: (updater) => set((state) => ({
      systemHealth: typeof updater === 'function' ? updater(state.systemHealth) : { ...state.systemHealth, ...updater }
  }))
}));

export default useAppStore;

=========================================
/// FILE: src\utils\helpers.js
=========================================



=========================================
/// FILE: api\binance.js
=========================================

/// FILE: api/binance.js
export const config = {
  runtime: 'edge', // Bắt buộc chạy trên Edge Network để giảm tối đa độ trễ
};

// Sử dụng Web Crypto API thay thế thư viện crypto của Node.js
async function hmacSha256(key, message) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default async function handler(req) {
  const API_KEY = process.env.BINANCE_API_KEY;
  const API_SECRET = process.env.BINANCE_API_SECRET;
  const url = new URL(req.url);

  try {
    // LUỒNG POST GIỮ NGUYÊN BỘ MÃ HÓA MỚI (Dù Frontend dùng Localhost, API vẫn sẵn sàng)
    if (req.method === 'POST') {
      if (!API_KEY || !API_SECRET) return new Response(JSON.stringify({ error: 'Missing API Keys.' }), { status: 500 });
      const body = await req.json();

      if (body.action === 'SIGN_TRADFI') {
        const params = new URLSearchParams();
        params.append('timestamp', Date.now().toString());
        params.append('recvWindow', '5000');
        
        const queryString = params.toString();
        const signature = await hmacSha256(API_SECRET, queryString);
        const targetUrl = `https://fapi.binance.com/fapi/v1/stock/contract?${queryString}&signature=${signature}`;
        
        const binanceRes = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const textRaw = await binanceRes.text();
        let data; try { data = JSON.parse(textRaw); } catch(e) { data = { msg: textRaw }; }
        if (!binanceRes.ok) return new Response(JSON.stringify({ error: 'TradFi Sign Failed', details: data }), { status: binanceRes.status });
        return new Response(JSON.stringify(data), { status: 200 });
      }
      
      return new Response(JSON.stringify({ error: 'Orders must go through Local Bridge' }), { status: 400 });
    }

    // LUỒNG GET: TÍCH HỢP MULTI-TIER CACHING & EDGE PROXY
    if (req.method === 'GET') {
      const path = url.searchParams.get('path');
      const isPrivate = url.searchParams.get('isPrivate');
      
      if (!path) return new Response(JSON.stringify({ error: 'Missing path parameter' }), { status: 400 });

      let baseUrl = 'https://api.binance.com';
      if (path.startsWith('/fapi') || path.startsWith('/futures')) {
        baseUrl = 'https://fapi.binance.com';
      }

      const params = new URLSearchParams();
      for (const [key, value] of url.searchParams.entries()) {
         if (key !== 'path' && key !== 'isPrivate' && key !== 't' && value !== '') {
             params.append(key, value);
         }
      }
      
      let queryString = params.toString();
      let headers = new Headers({ 'Content-Type': 'application/json' });

      // Đối với Dữ liệu Cá nhân (Read-Only)
      if (isPrivate === 'true') {
        if (!API_KEY || !API_SECRET) return new Response(JSON.stringify({ error: 'Missing API Keys' }), { status: 500 });
        const timestamp = Date.now().toString();
        queryString += (queryString ? '&' : '') + `timestamp=${timestamp}&recvWindow=5000`;
        const signature = await hmacSha256(API_SECRET, queryString);
        queryString += `&signature=${signature}`;
        headers.set('X-MBX-APIKEY', API_KEY);
      }

      const targetUrl = `${baseUrl}${path}${queryString ? '?' + queryString : ''}`;
      const binanceRes = await fetch(targetUrl, { headers });
      
      const responseHeaders = new Headers({ 'Content-Type': 'application/json' });
      const weight1m = binanceRes.headers.get('x-mbx-used-weight-1m');
      if (weight1m) {
          responseHeaders.set('x-mbx-used-weight-1m', weight1m);
          responseHeaders.set('Access-Control-Expose-Headers', 'x-mbx-used-weight-1m');
      }

      // KÍCH HOẠT CACHE 15 GIÂY CHO DỮ LIỆU CÔNG KHAI
      if (isPrivate !== 'true') {
          responseHeaders.set('Cache-Control', 's-maxage=5, stale-while-revalidate=55');
      }

      const textRaw = await binanceRes.text();
      let data;
      try { data = JSON.parse(textRaw); } 
      catch (err) { return new Response(JSON.stringify({ error: 'Invalid JSON', content: textRaw.substring(0, 200) }), { status: 502 }); }

      return new Response(JSON.stringify(data), { status: binanceRes.status, headers: responseHeaders });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Edge Server Error', message: error.message }), { status: 500 });
  }
}

=========================================
/// FILE: api\cmc.js
=========================================

// File: api/cmc.js
export default async function handler(req, res) {
  // 1. Mở cửa CORS cho Frontend React của bạn
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 2. Gọi Keyless Public API từ môi trường Server (Vercel) để lách luật CORS của Browser
    const [globalRes, fgiRes] = await Promise.all([
      fetch('https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD'),
      fetch('https://pro-api.coinmarketcap.com/public-api/v3/fear-and-greed/latest')
    ]);

    if (!globalRes.ok || !fgiRes.ok) {
       throw new Error(`CMC API Error: Global(${globalRes.status}) FGI(${fgiRes.status})`);
    }

    const globalData = await globalRes.json();
    const fgiData = await fgiRes.json();

    // 3. Trả dữ liệu đã được gọt dũa sạch sẽ về cho App.jsx
    res.status(200).json({
      btcDominance: globalData.data?.btc_dominance || 55.0,
      totalMarketCap: globalData.data?.quote?.USD?.total_market_cap || 0,
      fgiValue: fgiData.data?.value || 50,
      fgiClassification: fgiData.data?.value_classification || "Neutral"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

=========================================
/// FILE: api\gemini.js
=========================================

// File: api/gemini.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ hỗ trợ phương thức POST' });
  }

  // Lấy key từ Environment Variables của Vercel
  const apiKey = process.env.GEMINI_API_KEY; 

  // Endpoint Interactions API mới nhất
  const targetUrl = "https://generativelanguage.googleapis.com/v1beta/interactions"; //

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', //
        'x-goog-api-key': apiKey //
      },
      body: JSON.stringify(req.body) // Trực tiếp truyền body từ Frontend
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server nội bộ', details: error.message });
  }
}

=========================================
/// FILE: package.json
=========================================

{
  "name": "trading-system",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "lucide-react": "^0.300.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^5.0.14"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.4.0",
    "vite": "^7.3.6" 
  }
}


=========================================
/// FILE: vite.config.js
=========================================

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});

=========================================
/// FILE: tailwind.config.js
=========================================

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

=========================================
/// FILE: index.html
=========================================

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Anti-Fragile Terminal</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>


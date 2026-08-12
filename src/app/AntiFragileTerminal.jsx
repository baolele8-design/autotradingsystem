// FILE: src/App.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { BrainCircuit, Activity, Loader2, ServerCrash, Bell, Server, Zap } from 'lucide-react';

import { supabase } from '../infrastructure/supabase/client.js';

import useLiveData from '../features/market-data/hooks/useLiveData.js';
import useMatrixScanner from '../features/scanner/hooks/useMatrixScanner.js';
import useExchangeConfig from '../features/exchange/hooks/useExchangeConfig.js';

import MatrixScanner from '../features/scanner/components/MatrixScanner.jsx';
import LiveMetrics from '../features/market-data/components/LiveMetrics.jsx';
import VectorState from '../features/market-analysis/components/VectorState.jsx';
import OrderForm from '../features/order-entry/components/OrderForm.jsx';
import LogicGates from '../features/trade-validation/components/LogicGates.jsx';
import AiAudit from '../features/ai-audit/components/AiAudit.jsx';
import TradeJournal from '../features/trade-journal/components/TradeJournal.jsx';
import useAppStore from './state/useAppStore.js';
import {
  applyMasterAuto,
  createTopPaperTrades,
  injectScannedSetup as loadScannedSetup,
  runQuantumCouncilAnalysis as analyzeWithQuantumCouncil,
  saveTradeLog,
  syncBinanceLedger
} from '../features/trading-workspace/application/workspaceActions.js';
import {
  EMPTY_TRADE_STATS,
  calculateTradeStats,
  deriveActiveTierClass,
  deriveLogicGates,
  deriveMathCore,
  deriveSystemScore,
  deriveVectorRegime
} from '../features/trading-workspace/model/deriveTradingState.js';

export const SYSTEM_VERSION = "v1.5.2";

export default function AntiFragileTerminal() {

  const { 
    symbol, setSymbol, 
    intervalTime, setIntervalTime, 
    mvrvZScore, mvrvSource, setMvrvZScore,
    tradeSetup, setTradeSetup,
    systemHealth, setSystemHealth,
    currentEpochId // <--- LẤY TỪ STORE CHO HỆ THỐNG THÍCH NGHI
  } = useAppStore();

  const [toast, setToast] = useState('');

  // GIỮ NGUYÊN BỘ CHỈ BÁO GỐC
  const [indicatorSpecs, setIndicatorSpecs] = useState({ emaFast: 12, emaSlow: 26, rsiPeriod: 14, bbPeriod: 20, bbStdDev: 2.0 });

  const [tradeLogs, setTradeLogs] = useState([]);
  const [tradeStats, setTradeStats] = useState(EMPTY_TRADE_STATS);

  // STATE MỚI CHO HỘI ĐỒNG LƯỢNG TỬ (JSON MODE)
  const [councilReports, setCouncilReports] = useState([]);
  const [chiefDecision, setChiefDecision] = useState(null);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [geminiCooldown, setGeminiCooldown] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const { dynamicMinNotionals, dynamicPool, stepSizes, tickSizes } = useExchangeConfig();

  const {
    loading, lastUpdated, systemError, liveCapital, availableBalance,
    binancePositions, leverageBrackets, tradeFees,
    autoData, cmcData, apiMacro, aiModel 
  } = useLiveData({
    symbol,
    intervalTime,
    indicatorSpecs,
    setMvrvZScore,
    setSystemHealth
  });

  const { 
    scannedTopSetups, isScanningBackground, sonarEnabled, setSonarEnabled 
  } = useMatrixScanner({ 
    liveCapital, autoData, mvrvZScore, tradeFees, apiMacro, showToast,
    dynamicPool, dynamicMinNotionals, setSystemHealth, systemHealth,
    tradeLogs
  });

  useEffect(() => {
    if (geminiCooldown > 0) { 
      const t = setTimeout(() => setGeminiCooldown(c => c - 1), 1000); 
      return () => clearTimeout(t); 
    }
  }, [geminiCooldown]);

  // TỰ ĐỘNG BƠM MVRV XUỐNG BACKEND KHI NHẬP TAY
  useEffect(() => {
    if (mvrvSource !== 'manual') return;
    const syncTimer = setTimeout(() => {
      fetch('/api/mvrv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mvrvZScore })
      }).catch(e => console.warn("Lỗi sync MVRV:", e.message));
    }, 500); // Đợi 500ms sau khi ngừng nhập mới gửi

    return () => clearTimeout(syncTimer); // Dọn dẹp timer nếu mvrvZScore thay đổi liên tục
  }, [mvrvSource, mvrvZScore]);
  
  const fetchTradeLogs = async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.from('trade_logs').select('*').order('created_at', { ascending: false }).limit(300);
      if (!error && data) setTradeLogs(data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    fetchTradeLogs();
    const subscription = supabase.channel('public:trade_logs').on('postgres_changes', { event: '*', schema: 'public', table: 'trade_logs' }, (payload) => {
        if (payload.eventType === 'INSERT') setTradeLogs(current => [payload.new, ...current].slice(0, 300));
        else if (payload.eventType === 'UPDATE') setTradeLogs(current => current.map(log => log.id === payload.new.id ? payload.new : log));
        else if (payload.eventType === 'DELETE') setTradeLogs(current => current.filter(log => log.id !== payload.old.id));
      }).subscribe();
    return () => supabase.removeChannel(subscription);
  }, []);

  useEffect(() => {
    setTradeStats(calculateTradeStats(tradeLogs, symbol));
  }, [tradeLogs, symbol]);

  const activeTierClass = useMemo(
    () => deriveActiveTierClass({ autoData, apiMacro, symbol }),
    [symbol, autoData, apiMacro]
  );

  const vectorRegime = useMemo(
    () =>
      deriveVectorRegime({
        autoData,
        apiMacro,
        cmcData,
        mvrvZScore,
        symbol
      }),
    [lastUpdated, apiMacro, cmcData, mvrvZScore, symbol]
  );

  const systemScore = useMemo(
    () =>
      deriveSystemScore({
        autoData,
        apiMacro,
        vectorRegime,
        tradeSetup,
        mvrvZScore,
        symbol,
        activeTierClass
      }),
    [
      lastUpdated,
      apiMacro,
      vectorRegime,
      tradeSetup.direction,
      tradeSetup.activeStrategyId,
      mvrvZScore,
      symbol,
      activeTierClass
    ]
  );

  const mathCore = useMemo(
    () =>
      deriveMathCore({
        autoData,
        apiMacro,
        liveCapital,
        availableBalance,
        tradeSetup,
        symbol,
        tradeStats,
        leverageBrackets,
        vectorRegime,
        tradeFees,
        dynamicMinNotionals,
        systemScore,
        intervalTime,
        activeTierClass,
        btcRegime: tradeSetup.btcRegime
      }),
    [
      autoData,
      apiMacro,
      liveCapital,
      availableBalance,
      tradeSetup,
      symbol,
      tradeStats,
      leverageBrackets,
      vectorRegime,
      tradeFees,
      dynamicMinNotionals,
      systemScore.score,
      intervalTime
    ]
  );

  const logicGates = useMemo(
    () =>
      deriveLogicGates({
        autoData,
        apiMacro,
        mathCore,
        vectorRegime,
        tradeSetup,
        systemScore,
        tradeLogs,
        symbol
      }),
    [
      lastUpdated,
      mathCore,
      tradeSetup,
      apiMacro,
      vectorRegime,
      symbol,
      systemScore,
      tradeLogs
    ]
  );

  // ==============================================================
  // LUỒNG AI TRANH BIỆN LƯỢNG TỬ (BACKEND SERVERLESS)
  // ==============================================================
  const runQuantumCouncilAnalysis = () =>
    analyzeWithQuantumCouncil({
      geminiCooldown,
      autoData,
      mathCore,
      vectorRegime,
      setIsAnalyzing,
      setChiefDecision,
      setCouncilReports,
      symbol,
      intervalTime,
      apiMacro,
      tradeSetup,
      mvrvZScore,
      logicGates,
      tradeStats,
      tradeLogs,
      tickSizes,
      setTradeSetup,
      showToast,
      setGeminiCooldown
    });

  const handleSaveTradeLog = executionMetrics =>
    saveTradeLog(
      {
        supabase,
        autoData,
        symbol,
        apiMacro,
        intervalTime,
        tradeSetup,
        mathCore,
        mvrvZScore,
        systemScore,
        vectorRegime,
        logicGates,
        liveCapital,
        systemVersion: SYSTEM_VERSION,
        currentEpochId,
        setTradeLogs,
        showToast
      },
      executionMetrics
    );

  const syncBinanceToSupabase = (isSilent = false) =>
    syncBinanceLedger(
      {
        supabase,
        tradeLogs,
        setIsSyncing,
        showToast,
        fetchTradeLogs
      },
      isSilent
    );

  const handleMasterAuto = () =>
    applyMasterAuto({
      autoData,
      vectorRegime,
      apiMacro,
      aiModel,
      activeTierClass,
      mvrvZScore,
      symbol,
      tickSizes,
      setTradeSetup,
      showToast
    });

  const handlePaperTradeTop10 = () =>
    createTopPaperTrades({
      scannedTopSetups,
      showToast,
      liveCapital,
      tradeSetup,
      supabase
    });

  const injectScannedSetup = setup =>
    loadScannedSetup(
      {
        setSymbol,
        setIntervalTime,
        setTradeSetup,
        showToast
      },
      setup
    );

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
            <button 
             onClick={handlePaperTradeTop10} 
             className="bg-purple-900/40 hover:bg-purple-600/60 text-purple-300 border border-purple-500/50 px-3 py-1.5 rounded text-[10px] font-black flex items-center gap-2 transition-all shadow-[0_0_10px_rgba(168,85,247,0.2)]"
          >
             <Zap className="w-3 h-3" /> BẮN 10 LỆNH ẢO
          </button>
          <div className={`px-2 py-1 rounded text-[9px] font-bold border flex flex-col items-center ${systemHealth.weight > 2000 ? 'bg-red-950/50 text-red-400 border-red-900 animate-pulse' : systemHealth.weight > 1200 ? 'bg-amber-950/50 text-amber-400 border-amber-900' : 'bg-slate-900/50 text-emerald-400 border-slate-700'}`}>
              <span>API LIMIT: {systemHealth.weight}/{systemHealth.maxWeight}</span>
              <span className={`text-[7px] ${systemHealth.latency > 3000 ? 'text-red-500 animate-pulse' : 'text-slate-500'}`}>DATA AGE: {systemHealth.latency}ms</span>
          </div>

          <div className="flex items-center gap-2 bg-slate-900/50 p-1.5 rounded border border-slate-800">
            <select className="bg-black text-emerald-400 font-bold px-3 py-1.5 rounded border border-slate-700/50 outline-none text-sm cursor-pointer" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {dynamicPool.map(sym => (
                <option key={sym} value={sym}>{sym.replace('USDT', '/USDT')}</option>
              ))}
            </select>
            <select className="bg-black text-blue-400 font-bold px-3 py-1.5 rounded border border-slate-700/50 outline-none text-sm cursor-pointer" value={intervalTime} onChange={(e) => setIntervalTime(e.target.value)}>
              <option value="5m">M5 (Ngắn hạn)</option><option value="15m">M15 (Day)</option><option value="1h">H1 (Swing)</option>
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
          <LiveMetrics autoData={autoData} apiMacro={apiMacro} cmcData={cmcData} indicatorSpecs={indicatorSpecs} mvrvZScore={mvrvZScore} setMvrvZScore={setMvrvZScore} activeTierClass={activeTierClass} />
          <VectorState vectorRegime={vectorRegime} mvrvZScore={mvrvZScore} autoData={autoData} />
          <OrderForm 
            autoData={autoData} tradeSetup={tradeSetup} setTradeSetup={setTradeSetup} 
            liveCapital={liveCapital} availableBalance={availableBalance} mathCore={mathCore} tradeStats={tradeStats} 
            symbol={symbol} handleMasterAuto={handleMasterAuto} 
            stepSizes={stepSizes} tickSizes={tickSizes}
            handleSaveTradeLog={handleSaveTradeLog}
            syncBinanceToSupabase={syncBinanceToSupabase}
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
          <AiAudit 
            autoData={autoData} 
            runQuantumCouncilAnalysis={runQuantumCouncilAnalysis} 
            isAnalyzing={isAnalyzing} 
            geminiCooldown={geminiCooldown} 
            councilReports={councilReports}
            chiefDecision={chiefDecision}
          />
        </div>
      </div>
    </div>
  );
}

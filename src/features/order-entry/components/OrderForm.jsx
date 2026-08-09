// FILE: src/components/terminal/OrderForm.jsx
import React, { useState } from 'react';
import { Zap, TrendingUp, TrendingDown, BarChart3, Lock, Rocket, Loader2, Target, FileSignature } from 'lucide-react'; 
import {
  getStrategyDefinition,
  ROLLOUT_MODE
} from '../../../domain/trading/strategyRouter.js';

const FALLBACK_STRATEGY_BY_DIRECTION = Object.freeze({
  LONG: Object.freeze({
    strategyId: 'ADAPTIVE_LONG_FALLBACK',
    displayName: 'Adaptive Long Fallback'
  }),
  SHORT: Object.freeze({
    strategyId: 'ADAPTIVE_SHORT_FALLBACK',
    displayName: 'Adaptive Short Fallback'
  })
});

export default function OrderForm({
  autoData, tradeSetup, setTradeSetup, liveCapital, availableBalance, mathCore, tradeStats, 
  symbol, handleMasterAuto, stepSizes, tickSizes,
  handleSaveTradeLog, syncBinanceToSupabase 
}) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [execStatus, setExecStatus] = useState('');
  const activeStrategyId =
    tradeSetup.activeStrategyId || tradeSetup.activeStrategy || '';
  const activeStrategyDefinition = getStrategyDefinition(activeStrategyId);
  const hasValidStrategyMetadata = Boolean(
    activeStrategyDefinition &&
    tradeSetup.strategyRolloutMode === activeStrategyDefinition.rolloutMode &&
    activeStrategyDefinition.supportedDirections.includes(tradeSetup.direction)
  );
  const isPaperOnlyStrategy =
    tradeSetup.strategyRolloutMode === ROLLOUT_MODE.PAPER_ONLY ||
    activeStrategyDefinition?.rolloutMode === ROLLOUT_MODE.PAPER_ONLY;
  const isStrategyExecutionBlocked =
    !hasValidStrategyMetadata || isPaperOnlyStrategy;

  const handleDirectionChange = nextDirection => {
    if (!FALLBACK_STRATEGY_BY_DIRECTION[nextDirection]) return;

    setTradeSetup(previous => {
      if (previous.direction === nextDirection) return previous;

      const fallback = FALLBACK_STRATEGY_BY_DIRECTION[nextDirection];
      return {
        ...previous,
        direction: nextDirection,
        entry: 0,
        slTech: 0,
        tp1: 0,
        activeStrategy: fallback.strategyId,
        activeStrategyId: fallback.strategyId,
        activeStrategyLabel: fallback.displayName,
        strategyFamily: 'ADAPTIVE',
        strategyRolloutMode: ROLLOUT_MODE.LIVE,
        tHoldModifier: 1,
        holdingCycles: undefined
      };
    });
    setExecStatus('Đã đổi hướng. Hãy chạy AUTO SYNC hoặc nhập lại Entry/SL/TP trước khi đặt lệnh.');
  };

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
    if (!hasValidStrategyMetadata) {
        setExecStatus('❌ TỪ CHỐI: Metadata chiến thuật không hợp lệ hoặc không khớp hướng lệnh.');
        return;
    }
    if (activeStrategyDefinition.rolloutMode !== ROLLOUT_MODE.LIVE) {
        setExecStatus('🧪 PAPER ONLY: Chiến thuật này không được phép gửi lệnh thật lên Binance.');
        return;
    }
    if (mathCore.hasMinNotionalError || tradeSetup.entry <= 0 || tradeSetup.slTech <= 0) {
        setExecStatus('❌ LỖI SETUP: Check lại Min Notional hoặc Entry/SL');
        return;
    }

    setIsExecuting(true);
    setExecStatus('Đang tiền trạm & Phóng lệnh...');

    // ĐO LƯỜNG ĐỘ TRỄ THỰC THI (LATENCY) BẮT ĐẦU TẠI ĐÂY
    const requestStartTime = performance.now(); 

    try {
        const step = stepSizes[symbol] || 0.001;
        const tick = tickSizes[symbol] || 0.001;

        const formatPrecision = (val, step) => {
            const numVal = parseFloat(val);
            const numStep = parseFloat(step);
            if (isNaN(numVal) || isNaN(numStep) || numStep === 0) return "0";
            
            let stepStr = numStep.toString();
            if (stepStr.includes('e-')) {
                stepStr = numStep.toFixed(parseInt(stepStr.split('e-')[1], 10));
            }
            const precision = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
            
            // Khắc phục sai số Dấu phẩy động (Floating point error) của JS
            const multiplier = Math.pow(10, precision);
            const quantized = Math.round(numVal / numStep) * numStep;
            
            // Ép tròn chuỗi khít với TickSize
            return quantized.toFixed(precision);
        };

        const rawQty = parseFloat(mathCore.positionSizeUSD) / tradeSetup.entry;
        const finalQty = formatPrecision(rawQty, step);
        const finalEntry = formatPrecision(tradeSetup.entry, tick);
        const finalSl = formatPrecision(tradeSetup.slTech, tick);
        const finalTp = formatPrecision(tradeSetup.tp1, tick);

        const batch = [];
        const side = tradeSetup.direction === 'LONG' ? 'BUY' : 'SELL';
        const exitSide = tradeSetup.direction === 'LONG' ? 'SELL' : 'BUY';

        // 1. LỆNH ENTRY (Chung cho cả Spot và Futures)
        batch.push({
            symbol: symbol,
            side: side,
            type: tradeSetup.execution,
            quantity: finalQty,
            ...(tradeSetup.execution === 'LIMIT' ? { price: finalEntry, timeInForce: 'GTC' } : {})
        });

        // 2. BẺ NHÁNH ĐIỀU KIỆN SL/TP (PHÂN BIỆT RÕ RÀNG SPOT VÀ FUTURES)
        if (tradeSetup.tradeType === 'FUTURES') {
            // [CHUẨN FUTURES]: Đòi hỏi triggerPrice và reduceOnly
            if (parseFloat(finalSl) > 0) {
                batch.push({ symbol, side: exitSide, type: 'STOP_MARKET', triggerPrice: finalSl, quantity: finalQty, reduceOnly: "true", workingType: "MARK_PRICE", priceProtect: "true" });
            }
            if (parseFloat(finalTp) > 0) {
                batch.push({ symbol, side: exitSide, type: 'TAKE_PROFIT_MARKET', triggerPrice: finalTp, quantity: finalQty, reduceOnly: "true", workingType: "MARK_PRICE", priceProtect: "true" });
            }
        } else {
            // [CHUẨN SPOT ALGO API]: Đòi hỏi stopPrice
            if (parseFloat(finalSl) > 0) {
                batch.push({ symbol, side: exitSide, type: 'STOP_LOSS', stopPrice: finalSl, quantity: finalQty });
            }
            if (parseFloat(finalTp) > 0) {
                batch.push({ symbol, side: exitSide, type: 'TAKE_PROFIT', stopPrice: finalTp, quantity: finalQty });
            }
        }

        const payload = {
            symbol: symbol,
            tradeType: tradeSetup.tradeType, // Bơm biến này để Backend biết đường phân luồng
            strategyId: activeStrategyDefinition.strategyId,
            strategyRolloutMode: tradeSetup.strategyRolloutMode,
            direction: tradeSetup.direction,
            leverage: mathCore.suggestedLeverage,
            marginType: 'ISOLATED',
            batchOrders: batch
        };

        const LOCAL_BRIDGE_URL = '/api/execute-batch';
        const res = await fetch(LOCAL_BRIDGE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.details?.msg || data.error || 'Bridge Cục bộ từ chối.');

        // BỘ ĐỌC LỖI NÂNG CẤP: Bóc tách chính xác lý do sàn Binance từ chối
        if (Array.isArray(data)) {
            const errors = data.filter(r => r.error === true || r.code !== undefined);
            if (errors.length > 0) {
                const errorMsgs = errors.map(e => e.msg || e.code).join(" | ");
                console.error("LỖI CHI TIẾT TỪ BINANCE:", errors);
                throw new Error(`Entry đã khớp nhưng sàn TỪ CHỐI SL/TP. Lý do: [${errorMsgs}]. Hãy check app Binance!`);
            }
        }

        // CHỐT THỜI GIAN ĐỘ TRỄ VÀ TÍNH TOÁN SLIPPAGE
        const executionLatencyMs = Math.round(performance.now() - requestStartTime);
        let slippageUsd = 0;
        let executedEntry = tradeSetup.entry; // Thêm biến này
        
        // Bắt chính xác Giá Khớp Thực Tế (avgPrice) do Binance trả về cho lệnh MARKET
        if (tradeSetup.execution === 'MARKET' && Array.isArray(data) && data[0] && data[0].avgPrice) {
            executedEntry = parseFloat(data[0].avgPrice);
            slippageUsd = Math.abs(executedEntry - tradeSetup.entry) * parseFloat(finalQty);
        }

        setExecStatus('✅ LỆNH ĐÃ VÀO SÀN! Đang tự động lưu sổ cái...');
        
        if (typeof handleSaveTradeLog === 'function') {
            await handleSaveTradeLog({
               latency: executionLatencyMs,
               slippage: slippageUsd,
               exactEntry: executedEntry // TRUYỀN GIÁ THẬT LÊN APP.JSX
            });
        }

        setTimeout(() => {
            if (typeof syncBinanceToSupabase === 'function') {
                syncBinanceToSupabase(true);
            }
        }, 3500);

        setTimeout(() => setExecStatus(''), 6000);

    } catch (err) {
        // ĐÂY LÀ ĐOẠN ĐÃ BỊ THIẾU TRƯỚC ĐÓ LÀM VITE BÁO LỖI
        setExecStatus('❌ LỖI: ' + err.message);
    }
    
    setIsExecuting(false);
  };

  // --- GIỮ NGUYÊN HOÀN TOÀN GIAO DIỆN HTML/JSX CŨ BÊN DƯỚI ---
  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl">
      <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
        <button onClick={handleMasterAuto} disabled={!autoData} className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-2">
          <Zap className="w-3 h-3" /> AUTO SYNC TEMPLATE
        </button>

        <button 
          onClick={handleExecuteBatch} 
          disabled={isExecuting || !autoData || mathCore.hasInsufficientMargin || isStrategyExecutionBlocked}
          className={`px-4 py-1.5 rounded text-[10px] font-black flex items-center gap-2 transition-all shadow-lg
            ${isExecuting ? 'bg-slate-800 text-slate-500' : isStrategyExecutionBlocked ? 'bg-purple-950/60 text-purple-300 border border-purple-700 cursor-not-allowed' : mathCore.hasInsufficientMargin ? 'bg-pink-900/50 text-pink-400 border border-pink-900 cursor-not-allowed' : 'bg-emerald-600 text-black hover:bg-emerald-500 border border-emerald-400'}`}
        >
          {isExecuting ? <Loader2 className="w-3 h-3 animate-spin"/> : <Rocket className="w-3 h-3" />} 
          {isPaperOnlyStrategy ? 'PAPER ONLY · KHÔNG GỬI SÀN' : 'PHÓNG LỆNH & LƯU SỔ TAY'}
        </button>
      </div>

      {execStatus && (
          <div className={`mb-3 text-[10px] font-bold p-2 rounded border flex flex-col gap-2 ${execStatus.includes('✅') ? 'bg-emerald-950/30 text-emerald-400 border-emerald-900' : 'bg-red-950/30 text-red-400 border-red-900'} animate-pulse`}>
              <span>{execStatus}</span>
              
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
            <button onClick={() => handleDirectionChange('LONG')} className={`flex-1 py-1.5 text-[10px] font-bold rounded flex justify-center gap-1 shadow-sm ${tradeSetup.direction === 'LONG' ? 'bg-emerald-500 text-black' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}><TrendingUp className="w-3 h-3"/> LONG</button>
            <button onClick={() => handleDirectionChange('SHORT')} className={`flex-1 py-1.5 text-[10px] font-bold rounded flex justify-center gap-1 shadow-sm ${tradeSetup.direction === 'SHORT' ? 'bg-red-500 text-white' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}><TrendingDown className="w-3 h-3"/> SHORT</button>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
             <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 col-span-2 flex flex-col gap-2">
                <div className="flex justify-between">
                  <div className="w-1/2 pr-2 border-r border-slate-800">
                    <label className="text-[8px] font-bold text-slate-400 block mb-1">EQUITY <span className="text-slate-600 mx-1">|</span> <span className="text-cyan-400">FREE MARGIN</span></label>
                    <div className="flex items-baseline gap-1.5">
                       <span className="text-emerald-400 font-bold text-sm">${liveCapital.toFixed(2)}</span>
                       <span className="text-cyan-500 font-bold text-[10px]">${availableBalance.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="w-1/2 pl-2">
                    <label className="text-[8px] font-bold text-slate-400 block mb-1">BASE RISK: {tradeSetup.riskPercent}%</label>
                    <input type="number" step="0.1" max="5" value={tradeSetup.riskPercent} onChange={e=>setTradeSetup({...tradeSetup, riskPercent: Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
                  </div>
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
          
          <div className="mt-2 mb-1 flex items-center justify-between border-b border-slate-800 pb-2">
             <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                 <Target className="w-3.5 h-3.5 text-blue-500" /> CHIẾN THUẬT AUTO:
             </span>
             <span className={`text-[10px] font-black px-2 py-0.5 rounded border shadow-lg
                 ${tradeSetup.strategyRolloutMode === 'PAPER_ONLY'
                   ? 'bg-purple-900/30 text-purple-300 border-purple-500/50'
                   : 'bg-emerald-900/20 text-emerald-300 border-emerald-700/50'}`}>
                 {tradeSetup.activeStrategyLabel || tradeSetup.activeStrategy || "Adaptive Fallback"}
                 {tradeSetup.strategyRolloutMode === 'PAPER_ONLY' ? ' · PAPER' : ''}
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
            
            {mathCore.hasInsufficientMargin && (
              <div className="text-[8px] text-pink-500 font-bold text-right -mt-2 animate-pulse">⚠️ LỖI: SỐ DƯ KHẢ DỤNG KHÔNG ĐỦ KÝ QUỸ (CẦN ${mathCore.marginUsedUSD})</div>
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

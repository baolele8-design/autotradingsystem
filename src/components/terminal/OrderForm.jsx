import React from 'react';
import { Zap, TrendingUp, TrendingDown, BarChart3, Lock } from 'lucide-react';
import { getMinNotional } from '../../config/constants';

export default function OrderForm({
  autoData,
  tradeSetup,
  setTradeSetup,
  liveCapital,
  mathCore,
  tradeStats,
  symbol,
  handleMasterAuto
}) {
  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl">
      <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
        <button onClick={handleMasterAuto} disabled={!autoData} className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-2">
          <Zap className="w-3 h-3" /> AUTO SYNC TEMPLATE
        </button>
      </div>

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
                    <label className="text-[8px] font-bold text-slate-400 block mb-1">MAX RISK: {tradeSetup.riskPercent}%</label>
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
          <div className="space-y-3 mt-4">
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
              <div className="text-[8px] text-amber-500 font-bold text-right -mt-2">⚠️ CẢNH BÁO: SIZE ĐÃ BỊ ÉP LÊN MỨC TỐI THIỂU CỦA SÀN (${getMinNotional(symbol)})</div>
            )}

            <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
              <span className="text-[10px] font-bold text-slate-500">Mất ròng tối đa (Risk):</span>
              <span className={`font-black text-sm ${mathCore.isSizeForcedByExchange ? 'text-amber-500' : 'text-red-400'}`}>${mathCore?.riskAmountUSD || '0.00'}</span>
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
                 {mathCore?.leverageExceedsExchangeCap && (
                   <div className="text-[7.5px] text-red-500 mt-1 font-bold animate-pulse text-right w-full">
                     ⚠️ BỊ ÉP TRẦN {mathCore?.liqEstimate?.maxLevForTier}X
                   </div>
                 )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
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
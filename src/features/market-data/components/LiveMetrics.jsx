import React from 'react';
import { Database } from 'lucide-react';

export default function LiveMetrics({ 
  autoData, 
  apiMacro, 
  cmcData, 
  indicatorSpecs, 
  mvrvZScore, 
  setMvrvZScore, 
  activeTierClass
}) {
  const getTierStyle = (tierStr) => {
      if (!tierStr) return 'bg-slate-900 text-slate-500 border-slate-800';
      if (tierStr.includes('Tier 1')) return 'bg-blue-950/50 text-blue-400 border-blue-500/50 shadow-[0_0_8px_rgba(59,130,246,0.3)]';
      if (tierStr.includes('Tier 2')) return 'bg-emerald-950/50 text-emerald-400 border-emerald-500/50';
      if (tierStr.includes('Tier 3')) return 'bg-amber-950/50 text-amber-400 border-amber-500/50';
      return 'bg-pink-950/50 text-pink-400 border-pink-500/50 animate-pulse'; // Tier 4 Nano
  };
  return (
    <div className="bg-[#111116] border border-blue-900/40 rounded-xl p-4 shadow-xl space-y-4">
      <div className="flex justify-between items-center border-b border-blue-900/30 pb-2">
        <h2 className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
          <Database className="w-3.5 h-3.5" /> LIVE DATA & ORDERBOOK METRICS
        </h2>
        {/* HIỂN THỊ TIER Ở GÓC PHẢI */}
        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border tracking-wider ${getTierStyle(activeTierClass)}`}>
          {activeTierClass}
        </span>
      </div>
      
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
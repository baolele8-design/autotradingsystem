import React from 'react';
import { History, RefreshCw, CheckCircle2, XCircle, TrendingUp, TrendingDown, Clock } from 'lucide-react';

export default function TradeJournal({ tradeLogs, currentPrice, syncBinanceToSupabase, isSyncing }) {
  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl mt-6">
      <div className="flex justify-between items-center mb-4 border-b border-slate-800/80 pb-3">
        <h2 className="text-[12px] font-black text-slate-300 uppercase flex items-center gap-2 tracking-widest">
          <History className="w-4 h-4 text-purple-500" /> SỔ TAY LƯỢNG TỬ (SUPABASE LOGS)
        </h2>
        <button 
          onClick={syncBinanceToSupabase}
          disabled={isSyncing}
          className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/30 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-2 transition-all"
        >
          <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} /> 
          {isSyncing ? 'ĐANG ĐỒNG BỘ BINANCE...' : 'ĐỒNG BỘ AUTO-SYNC'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
              <th className="pb-2">Trạng thái</th>
              <th className="pb-2">Cặp / Hướng</th>
              <th className="pb-2">Entry / SL / TP</th>
              <th className="pb-2">Regime / Soft Score</th>
              <th className="pb-2 text-right">PnL (USD)</th>
            </tr>
          </thead>
          <tbody className="text-[10px] font-mono">
            {tradeLogs.length === 0 ? (
              <tr><td colSpan="5" className="text-center py-4 text-slate-600">Chưa có dữ liệu giao dịch.</td></tr>
            ) : (
              tradeLogs.slice(0, 10).map((log) => {
                // Tính toán Live PnL nếu lệnh đang OPEN
                let displayPnl = parseFloat(log.pnl_usd || 0);
                let isLive = log.status === 'OPEN';
                
                if (isLive && currentPrice && log.entry) {
                  const sizeCoin = parseFloat(log.risk_amount_usd) / Math.abs(parseFloat(log.entry) - parseFloat(log.sl));
                  const priceDiff = parseFloat(currentPrice) - parseFloat(log.entry);
                  displayPnl = log.direction === 'LONG' ? priceDiff * sizeCoin : -priceDiff * sizeCoin;
                }

                return (
                  <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-900/30 transition-colors">
                    <td className="py-3 flex items-center gap-1.5">
                      {isLive ? <Clock className="w-3.5 h-3.5 text-amber-500 animate-pulse" /> : 
                       displayPnl > 0 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : 
                       <XCircle className="w-3.5 h-3.5 text-red-500" />}
                      <span className={`font-bold ${isLive ? 'text-amber-500' : displayPnl > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="font-black text-white">{log.symbol}</div>
                      <div className={`flex items-center gap-1 text-[9px] ${log.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {log.direction === 'LONG' ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>} {log.direction}
                      </div>
                    </td>
                    <td className="py-3 text-slate-400">
                      E: <span className="text-white">${parseFloat(log.entry).toFixed(4)}</span><br/>
                      S: <span className="text-red-400">${parseFloat(log.sl).toFixed(4)}</span> | T: <span className="text-emerald-400">${parseFloat(log.tp_1_price).toFixed(4)}</span>
                    </td>
                    <td className="py-3">
                      <div className="text-cyan-400 text-[8.5px] truncate max-w-[150px]">{log.market_regime}</div>
                      <div className="text-slate-500">AI Score: <span className="text-white font-bold">{parseFloat(log.soft_score).toFixed(1)}/10</span></div>
                    </td>
                    <td className={`py-3 text-right font-black ${displayPnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {displayPnl > 0 ? '+' : ''}{displayPnl.toFixed(2)}$
                      {isLive && <div className="text-[8px] text-slate-500 font-normal mt-0.5">(Live)</div>}
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
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
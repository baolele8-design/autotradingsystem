// File: src/components/terminal/TradeJournal.jsx
import React, { useMemo } from 'react';
import { History, RefreshCw, CheckCircle2, XCircle, TrendingUp, TrendingDown, Clock, Link, AlertTriangle, Trash2, Calculator, CalendarDays, Trophy } from 'lucide-react';
import { deleteTradeLog } from '../../../shared/ledgerClient.js';
import { getTrailingPolicy } from '../../../domain/trading/trailingPolicy.js';

const findPositionForLog = (positions, log) => positions.find(position => {
  if (position.symbol !== log.symbol) return false;
  const amount = parseFloat(position.positionAmt);
  if (!Number.isFinite(amount) || amount === 0) return false;
  const positionSide = String(position.positionSide || 'BOTH').toUpperCase();
  if (positionSide === 'LONG' || positionSide === 'SHORT') {
    return positionSide === String(log.direction).toUpperCase();
  }
  return log.direction === 'LONG' ? amount > 0 : amount < 0;
});

export default function TradeJournal({ tradeLogs, currentPrice, syncBinanceToSupabase, isSyncing, binancePositions }) {
  
  const activeLogSymbols = tradeLogs.filter(l => l.status === 'OPEN' || l.status === 'PENDING').map(l => l.symbol);
  const ghostPositions = binancePositions.filter(p => !activeLogSymbols.includes(p.symbol) && parseFloat(p.positionAmt) !== 0);

// ========Tính Lợi nhuận chuẩn theo R (Dùng Risk Gốc để chống lỗi chia 0 khi đã dời SL)
  // ========Tính Lợi nhuận chuẩn theo Technical R (Tái tạo R gốc bằng Nghịch đảo R:R)
  const getProfitProgress = (log) => {
    const isLive = log.status === 'OPEN';
    if (!isLive) return null;

    const actualPos = findPositionForLog(binancePositions, log);
    if (!actualPos || parseFloat(actualPos.positionAmt) === 0) return null;

    const entry = parseFloat(log.entry);
    const sl = parseFloat(log.sl);
    const tp = parseFloat(log.tp_1_price);
    const markPrice = parseFloat(actualPos.markPrice || entry);
    const sizeCoin = parseFloat(log.position_size_usd) / entry;

    // 💡 BẢN VÁ: Khôi phục Rủi ro Kỹ thuật (Technical Risk)
    let originalRiskPerCoin = parseFloat(log.initial_risk_per_coin);
    if (!Number.isFinite(originalRiskPerCoin) || originalRiskPerCoin <= 0) {
      if (!log.trailing_activated) {
        // Trailing chưa kích hoạt -> SL hiện tại chính là SL gốc
        originalRiskPerCoin = Math.abs(entry - sl);
      } else {
        // Trailing ĐÃ kích hoạt (SL bị dời) -> Tái tạo SL gốc bằng R:R nghịch đảo
        const rewardPerCoin = Math.abs(tp - entry);
        const theoreticalRR = parseFloat(log.rr) || 1;
        originalRiskPerCoin = rewardPerCoin / theoreticalRR;
      }
    }

    const totalRiskUsd = originalRiskPerCoin * sizeCoin;
    if (totalRiskUsd <= 0) return null;

    const currentPnl = log.direction === 'LONG'
      ? (markPrice - entry) * sizeCoin
      : (entry - markPrice) * sizeCoin;

    const currentR = currentPnl / totalRiskUsd;
    const totalRewardUsd = Math.abs(tp - entry) * sizeCoin;
    const targetR = totalRewardUsd / totalRiskUsd;

    return { currentR, currentPnl, targetR, isProfitable: currentPnl > 0 };
  };

  // Danh sách các lệnh đang lời nhưng CHƯA đạt ngưỡng khóa lời
  const atRiskOfEarlyExit = useMemo(() => {
    return tradeLogs
      .filter(log => log.status === 'OPEN')
      .map(log => ({ log, progress: getProfitProgress(log) }))
      // SỬA LỖI: Thay progress.pct thành tỷ lệ giữa currentR và targetR
      .filter(({ progress }) => progress && progress.isProfitable && progress.currentR < progress.targetR); 
  }, [tradeLogs, binancePositions]);
  //=============================================================

  const { sortedLogs, totalRealized, totalFloating, netTotalPnL } = useMemo(() => {
    let realized = 0;
    let floating = 0;

    tradeLogs.forEach(log => {
      if (log.status === 'WIN' || log.status === 'LOSS') {
        realized += parseFloat(log.pnl_usd || 0);
      }
      if (log.status === 'OPEN' || log.status === 'PENDING') {
        const actualPos = findPositionForLog(binancePositions, log);
        if (actualPos && parseFloat(actualPos.positionAmt) !== 0) {
           const markPrice = parseFloat(actualPos.markPrice || log.entry);
           const sizeCoin = parseFloat(log.position_size_usd) / parseFloat(log.entry);
           const isolatedPnl = log.direction === 'LONG' 
              ? (markPrice - parseFloat(log.entry)) * sizeCoin
              : (parseFloat(log.entry) - markPrice) * sizeCoin;
           floating += isolatedPnl;
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

  // 📊 PHÂN TÍCH 1: PNL THEO NGÀY (7 NGÀY GẦN NHẤT)
  const dailyPnL = useMemo(() => {
    const daily = {};
    tradeLogs.forEach(t => {
        if (t.status === 'WIN' || t.status === 'LOSS') {
            const dateObj = t.close_time ? new Date(t.close_time) : new Date(t.created_at);
            const yyyy = dateObj.getFullYear();
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dd = String(dateObj.getDate()).padStart(2, '0');
            
            const sortKey = `${yyyy}-${mm}-${dd}`;
            const displayDate = `${dd}/${mm}`;
            
            if (!daily[sortKey]) daily[sortKey] = { displayDate, pnl: 0 };
            daily[sortKey].pnl += parseFloat(t.pnl_usd || 0);
        }
    });
    
    return Object.entries(daily)
        .sort(([keyA], [keyB]) => keyB.localeCompare(keyA)) 
        .slice(0, 7) 
        .map(([key, data]) => data);
  }, [tradeLogs]);

  const topStrategies = useMemo(() => {
    const stats = {};
    tradeLogs.forEach(t => {
        // Chỉ chấp nhận lệnh WIN/LOSS VÀ BẮT BUỘC phải có dữ liệu asset_tier
        if ((t.status === 'WIN' || t.status === 'LOSS') && t.asset_tier) {
            const strat = t.strategy_name || 'UNKNOWN';
            const tier = t.asset_tier.split(':')[0].trim(); 
            
            const key = `${strat}|${tier}`; 
            
            // Khởi tạo các biến để đo lường Thực tế
            if (!stats[key]) stats[key] = { 
                strat, tier, wins: 0, losses: 0, total: 0, pnl: 0, 
                win_r_sum: 0, loss_r_sum: 0 
            };
            
            stats[key].total += 1;
            stats[key].pnl += parseFloat(t.pnl_usd || 0);

            // TÍNH TOÁN R-MULTIPLE THỰC TẾ (REALIZED R)
            const riskUsd = parseFloat(t.risk_amount_usd) || 1; // Chống lỗi chia 0
            const pnlUsd = parseFloat(t.pnl_usd) || 0;
            const rMultiple = pnlUsd / riskUsd;
            
            if (t.status === 'WIN') {
                stats[key].wins += 1;
                stats[key].win_r_sum += rMultiple;
            } else if (t.status === 'LOSS') {
                stats[key].losses += 1;
                // Tổn thất lấy trị tuyệt đối để tính R:R mẫu số
                stats[key].loss_r_sum += Math.abs(rMultiple);
            }
        }
    });

    return Object.values(stats)
        .map(data => {
            // Trung bình R thực tế khi Thắng
            const avgWinR = data.wins > 0 ? (data.win_r_sum / data.wins) : 0;
            // Trung bình R thực tế khi Thua (Mặc định là 1 nếu chưa thua)
            const avgLossR = data.losses > 0 ? (data.loss_r_sum / data.losses) : 1; 
            
            // TỶ LỆ R:R THỰC TẾ (REALIZED R:R)
            const realizedRR = avgLossR > 0 ? (avgWinR / avgLossR) : avgWinR;

            return {
                strat: data.strat,
                tier: data.tier,
                winRate: (data.wins / data.total) * 100,
                avgRR: realizedRR, 
                total: data.total,
                pnl: data.pnl
            }
        })
        .filter(x => x.total >= 3) // Tối thiểu 3 lệnh
        .sort((a, b) => b.winRate - a.winRate || b.avgRR - a.avgRR) 
        .slice(0, 5);
  }, [tradeLogs]);


  const handleDeleteLog = async (log) => {
    if (log.status === 'OPEN') {
        alert(`⛔ KHÔNG THỂ XÓA: Lệnh ${log.symbol} đang chạy thực tế trên sàn. Bạn phải ĐÓNG VỊ THẾ (Close Position) trên app Binance trước!`);
        return;
    }
    const isConfirmed = window.confirm(`CẢNH BÁO: Xóa sổ tay lệnh ${log.symbol} [Trạng thái: ${log.status}]?`);
    if (!isConfirmed) return;

    try {
      if (log.status === 'PENDING') {
        const LOCAL_BRIDGE_URL = '/api/cancel-orphans';
        const cancelRes = await fetch(LOCAL_BRIDGE_URL, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: log.symbol, entry: log.entry, sl: log.sl, tp: log.tp_1_price })
        });
        const cancelData = await cancelRes.json();
        if (!cancelRes.ok) throw new Error(cancelData.details?.msg || cancelData.error || "Lỗi Bridge Cục bộ");
      }
      const { error } = await deleteTradeLog(log.id);
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

      {/* TỔNG KẾT PNL CHÍNH */}
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

      {/* CẢNH BÁO: LỆNH CÓ NGUY CƠ BỊ CHỐT NON (Alpha Decay Risk) */}
      {atRiskOfEarlyExit.length > 0 && (
        <div className="mb-5 bg-red-950/30 border-2 border-red-500/60 rounded-lg p-3 shadow-[0_0_15px_rgba(239,68,68,0.2)] animate-pulse">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <span className="text-[11px] font-black text-red-400 uppercase tracking-widest">
              ĐỪNG ĐÓNG TAY — {atRiskOfEarlyExit.length} lệnh đang lời nhưng chưa tới điểm khóa lãi
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {atRiskOfEarlyExit.map(({ log, progress }) => {
            const { currentR, targetR } = progress;
            // 🚀 BẢN VÁ: ĐỒNG BỘ ĐỘNG (DYNAMIC) NGƯỠNG TRAILING TỪ BACKEND
            const {
              beTrigger,
              lockTrigger,
              lockAmount,
              trailTrigger
            } = getTrailingPolicy(log.strategy_name, log.asset_tier);
            const protectionStage = String(
              log.protection_stage ||
              (log.trailing_activated ? 'BE' : 'NONE')
            ).toUpperCase();

            let nextGoalR = beTrigger;
            let prevGoalR = 0;
            let goalText = `Dời SL Hòa Vốn (${beTrigger.toFixed(2)}R)`;
            let barColor = "bg-amber-500";
            let textHighlight = "text-amber-400";
            
            if (protectionStage === 'TRAIL') {
                nextGoalR = targetR;
                prevGoalR = trailTrigger;
                goalText = "chạm Full TP";
                barColor = "bg-purple-500";
                textHighlight = "text-purple-400";
            }
            else if (protectionStage === 'LOCK') {
                nextGoalR = trailTrigger;
                prevGoalR = lockTrigger;
                goalText = `bật bám trend (${trailTrigger.toFixed(2)}R)`;
                barColor = "bg-emerald-500";
                textHighlight = "text-emerald-400";
            }
            else if (protectionStage === 'BE') {
                nextGoalR = lockTrigger;
                prevGoalR = beTrigger;
                goalText = `khóa lãi +${lockAmount.toFixed(2)}R`;
                barColor = "bg-blue-500";
                textHighlight = "text-blue-400";
            }
            else {
                nextGoalR = beTrigger;
                prevGoalR = 0;
                goalText = `Dời SL Hòa Vốn (${beTrigger.toFixed(2)}R)`;
                barColor = "bg-amber-500";
                textHighlight = "text-amber-400";
            }

            const rDisplay = currentR.toFixed(2);
            const neededR = nextGoalR.toFixed(2);
            
            // Tính độ dài thanh Bar giữa 2 mốc R
            const segmentWidth = Math.max(0.0001, nextGoalR - prevGoalR);
            const segmentProgress = Math.max(0, Math.min(100, ((currentR - prevGoalR) / segmentWidth) * 100));

            return (
              <div key={log.id} className="flex items-center justify-between bg-black/40 border border-red-900/40 rounded px-2.5 py-1.5 text-[9.5px] font-mono">
                <div className="flex items-center gap-2">
                  <span className="font-black text-white">{log.symbol}</span>
                  <span className={log.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>{log.direction}</span>
                  <span className="text-emerald-400 font-bold">+${progress.currentPnl.toFixed(2)}</span>
                </div>
                
                <div className="flex items-center gap-2 text-slate-400">
                  <span>Mức <span className="text-white font-bold">+{rDisplay}R</span> / Cần <span className={`font-bold ${textHighlight}`}>{neededR}R</span> để {goalText}</span>
                  <div className="w-16 h-1.5 bg-slate-800 rounded overflow-hidden">
                    <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${segmentProgress}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
          </div>
          <div className="text-[8.5px] text-red-400/80 mt-2 italic">
            ⚠️ Dữ liệu lịch sử cho thấy: các lệnh đóng tay sớm chỉ ăn trung bình ~17% mục tiêu, trong khi lệnh thua mất gần trọn Stoploss. Hãy để hệ thống Trailing tự bảo vệ.
          </div>
        </div>
      )}

      {/* DASHBOARD PHÂN TÍCH CHUYÊN SÂU */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        
        {/* PNL 7 NGÀY GẦN NHẤT */}
        <div className="bg-[#0a0a0c] p-3 rounded-lg border border-slate-800">
           <div className="text-[9px] font-bold text-slate-500 mb-2 flex items-center gap-1.5 uppercase tracking-widest">
              <CalendarDays className="w-3.5 h-3.5 text-blue-400"/> PnL 7 Ngày Gần Nhất
           </div>
           <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {dailyPnL.length === 0 ? <span className="text-[9px] text-slate-600 font-bold">Chưa có dữ liệu chốt lời/lỗ.</span> : 
                 dailyPnL.map((d, i) => (
                    <div key={i} className="flex flex-col items-center justify-center bg-black border border-slate-800 p-2 rounded min-w-[55px] shadow-sm">
                       <span className="text-[8px] font-bold text-slate-500 mb-1">{d.displayDate}</span>
                       <span className={`text-[10px] font-black ${d.pnl > 0 ? 'text-emerald-400' : d.pnl < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                          {d.pnl > 0 ? '+' : ''}{d.pnl.toFixed(1)}$
                       </span>
                    </div>
                 ))
              }
           </div>
        </div>

        {/* TOP 5 CHIẾN THUẬT - TIER */}
        <div className="bg-[#0a0a0c] p-3 rounded-lg border border-slate-800 flex flex-col">
           <div className="text-[9px] font-bold text-slate-500 mb-2 flex items-center justify-between uppercase tracking-widest border-b border-slate-800 pb-2">
              <span className="flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5 text-amber-400"/> Top 5 Alpha (Min 3 Lệnh)</span>
           </div>
           
           <div className="space-y-2 flex-grow overflow-y-auto pr-1" style={{ scrollbarWidth: 'none' }}>
              {topStrategies.length === 0 ? (
                 <span className="text-[9px] text-slate-600 font-bold flex items-center h-full justify-center">Chưa có tổ hợp nào đạt chuẩn 3 lệnh.</span>
              ) : (
                 topStrategies.map((s, i) => (
                    <div key={i} className="flex justify-between items-center bg-black border border-slate-800/80 px-2.5 py-2 rounded shadow-sm hover:border-slate-700 transition-colors">
                       
                       {/* THÔNG TIN CHIẾN THUẬT VÀ TIER */}
                       <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] font-bold text-slate-200 truncate max-w-[150px]" title={s.strat}>
                             {s.strat}
                          </span>
                          <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded border w-max tracking-wider
                              ${s.tier.includes('1') ? 'bg-blue-900/30 text-blue-400 border-blue-500/30' : 
                                s.tier.includes('2') ? 'bg-emerald-900/30 text-emerald-400 border-emerald-500/30' : 
                                s.tier.includes('3') ? 'bg-amber-900/30 text-amber-400 border-amber-500/30' : 
                                'bg-pink-900/30 text-pink-400 border-pink-500/30 shadow-[0_0_5px_rgba(236,72,153,0.2)]'}`}>
                              {s.tier}
                          </span>
                       </div>

                       {/* THỐNG KÊ WINRATE VÀ R:R */}
                       <div className="flex flex-col items-end gap-1">
                          <div className="flex items-baseline gap-2">
                             <span className="text-[8px] font-bold text-slate-500">N={s.total}</span>
                             <span className={`text-[11px] font-black ${s.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {s.winRate.toFixed(1)}%
                             </span>
                          </div>
                          <span className="text-[8.5px] font-mono text-cyan-400 font-bold bg-cyan-950/30 border border-cyan-900/50 px-1 rounded">
                             Avg R:R 1:{s.avgRR.toFixed(2)}
                          </span>
                       </div>

                    </div>
                 ))
              )}
           </div>
        </div>
      </div>

      {/* BẢNG LỊCH SỬ LỆNH (Giữ nguyên) */}
      <div className="overflow-x-auto max-h-[350px]" style={{ scrollbarWidth: 'thin', scrollbarColor: '#065f46 #0a0a0c' }}>
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
                   const actualPos = findPositionForLog(binancePositions, log);
                   if (actualPos && parseFloat(actualPos.positionAmt) !== 0) {
                      const markPrice = parseFloat(actualPos.markPrice || log.entry);
                      const sizeCoin = parseFloat(log.position_size_usd) / parseFloat(log.entry);
                      displayPnl = log.direction === 'LONG' 
                         ? (markPrice - parseFloat(log.entry)) * sizeCoin
                         : (parseFloat(log.entry) - markPrice) * sizeCoin;
                      
                      displayEntry = parseFloat(log.entry);
                      isLive = true; 
                      isPending = false;
                   }
                }

                return (
                  <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-900/50 transition-colors group">
                    <td className="py-2.5 flex items-center gap-1.5">
                      {isPending ? <Link className="w-3.5 h-3.5 text-blue-400 animate-pulse" /> : 
                       isLive ? <Clock className="w-3.5 h-3.5 text-amber-500 animate-spin-slow" /> : 
                       log.status === 'CANCELED' ? <XCircle className="w-3.5 h-3.5 text-slate-500" /> :
                       displayPnl > 0 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : 
                       <XCircle className="w-3.5 h-3.5 text-red-500" />}
                      <span className={`font-bold ${isPending ? 'text-blue-400' : isLive ? 'text-amber-500' : log.status === 'CANCELED' ? 'text-slate-500 line-through' : displayPnl > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {isPending ? 'CHỜ KHỚP' : log.status === 'CANCELED' ? 'ĐÃ HỦY' : log.status}
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
                      {isLive && (() => {
                      const progress = getProfitProgress(log);
                      
                      if (!progress || !progress.isProfitable) {
                          return <div className="text-[8px] text-slate-500 font-normal mt-0.5">(Live)</div>;
                      }
                      
                      // 🚀 BẢN VÁ: ĐỒNG BỘ NGƯỠNG HIỂN THỊ ĐỘNG TRONG NHÃN (LABEL)
                      const {
                        beTrigger
                      } = getTrailingPolicy(log.strategy_name, log.asset_tier);
                      const protectionStage = String(
                        log.protection_stage ||
                        (log.trailing_activated ? 'BE' : 'NONE')
                      ).toUpperCase();

                      if (protectionStage === 'TRAIL') {
                          return (
                            <div className="text-[8px] text-purple-400 font-bold mt-0.5 flex items-center gap-1 justify-end animate-pulse">
                              🌊 BÁM TREND (+{progress.currentR.toFixed(2)}R)
                            </div>
                          );
                      }
                      if (protectionStage === 'LOCK') {
                          return (
                            <div className="text-[8px] text-emerald-400 font-bold mt-0.5 flex items-center gap-1 justify-end drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]">
                              🔒 KHÓA LÃI (+{progress.currentR.toFixed(2)}R)
                            </div>
                          );
                      }
                      if (protectionStage === 'BE') {
                          return (
                            <div className="text-[8px] text-blue-400 font-bold mt-0.5 flex items-center gap-1 justify-end animate-pulse">
                              🛡️ HÒA VỐN (+{progress.currentR.toFixed(2)}R)
                            </div>
                          );
                      }
                      if (progress.currentR >= beTrigger) {
                          return (
                            <div className="text-[8px] text-amber-400 font-bold mt-0.5 flex items-center gap-1 justify-end">
                              ⏳ CHỜ ENGINE XÁC NHẬN (+{progress.currentR.toFixed(2)}R)
                            </div>
                          );
                      }
                      return (
                        <div className="text-[8px] text-amber-400 font-bold mt-0.5 flex items-center gap-1 justify-end">
                          <AlertTriangle className="w-2.5 h-2.5" /> Rủi ro mở (+{progress.currentR.toFixed(2)}R)
                        </div>
                      );
                    })()}
                    </td>
                    <td className="py-2.5 text-center">
                      <button 
                        onClick={() => handleDeleteLog(log)}
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

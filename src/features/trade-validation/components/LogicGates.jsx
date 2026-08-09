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

       {/* 1. CỬA TỬ - HARD GATES */}
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

       {/* 2. CỬA MỀM - SOFT GATES & MULTIPLIERS */}
       <div className="flex-grow mt-3">
          {/* HEADER HIỂN THỊ ĐIỂM CHUẨN ĐỘNG */}
          <div className="flex justify-between items-end mb-2 border-b border-slate-800 pb-2">
             <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest">
                Cửa Mềm - Adaptive Soft Gates
             </span>
             <span className="text-[9px] bg-slate-900 px-2 py-0.5 rounded border border-slate-700 text-slate-400 flex items-center gap-1.5 shadow-inner">
                <span>Pass: <span className="text-white font-bold">{logicGates.passingScore?.toFixed(1)}</span></span>
                <span className="text-slate-600">|</span>
                <span>Net Score: </span>
                <span className={`font-black text-[10px] ${logicGates.softScore >= logicGates.passingScore ? "text-emerald-400" : "text-amber-500"}`}>
                   {logicGates.softScore.toFixed(1)}
                </span>
             </span>
          </div>

          <div className="space-y-2">
            {logicGates.softGates.map((item) => {
              // Bỏ qua các cổng không dùng, ngoại trừ 2 cổng hệ số nhân
              if (item.weight === 0 && !item.id.includes('s_syn') && !item.id.includes('s_pen')) return null; 
              
              // ==========================================
              // RENDER ĐẶC BIỆT: HỆ SỐ KHUẾCH ĐẠI (SYNERGY)
              // ==========================================
              if (item.id === 's_syn') {
                  return (
                      <div key={item.id} className="flex items-start gap-2.5 bg-gradient-to-r from-emerald-900/40 to-transparent p-2 rounded border-l-2 border-emerald-500 mt-3 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                          <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5 animate-pulse" />
                          <span className="text-[9.5px] leading-relaxed font-black text-emerald-300">
                             HỆ SỐ KHUẾCH ĐẠI:<br/><span className="text-emerald-400/80 font-mono text-[8.5px]">{item.text.replace('🔥 SYNERGY BONUS:', '')}</span>
                          </span>
                      </div>
                  );
              }

              // ==========================================
              // RENDER ĐẶC BIỆT: HỆ SỐ TRỪNG PHẠT (PENALTY)
              // ==========================================
              if (item.id === 's_pen') {
                  return (
                      <div key={item.id} className="flex items-start gap-2.5 bg-gradient-to-r from-red-900/40 to-transparent p-2 rounded border-l-2 border-red-500 mt-3 shadow-[0_0_10px_rgba(239,68,68,0.1)]">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5 animate-pulse" />
                          <span className="text-[9.5px] leading-relaxed font-black text-red-300">
                             HỆ SỐ TRỪNG PHẠT:<br/><span className="text-red-400/80 font-mono text-[8.5px]">{item.text.replace('⚠️ MACRO PENALTY:', '')}</span>
                          </span>
                      </div>
                  );
              }

              // ==========================================
              // RENDER CÁC CỔNG SOFT GATES CƠ SỞ (BASE SCORE)
              // ==========================================
              return (
                <div key={item.id} className="flex items-center justify-between bg-blue-950/10 p-2 rounded border border-blue-900/20 transition-all hover:bg-blue-900/20">
                  <div className="flex items-start gap-2.5">
                    {item.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-slate-700 shrink-0 mt-0.5" />}
                    <span className={`text-[9.5px] leading-relaxed font-medium ${item.passed ? 'text-slate-300' : 'text-slate-600 line-through'}`}>{item.text}</span>
                  </div>
                  
                  {/* BẢN VÁ UI: Hiển thị ĐIỀU KIỆN (0đ) và ĐIỂM SỐ chi tiết */}
                  {item.score !== undefined && item.score !== 0 && (
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm ${item.score > 0 ? 'text-emerald-400 bg-emerald-950/50 border border-emerald-900/50' : 'text-red-400 bg-red-950/50 border border-red-900/50'}`}>
                      {item.score > 0 ? '+' : ''}{item.score.toFixed(1)}đ
                    </span>
                  )}
                  
                  {item.score === 0 && (
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded text-slate-400 bg-slate-800/50 border border-slate-700">
                      ĐIỀU KIỆN
                    </span>
                  )}
                </div>
              )
            })}
          </div>
       </div>

       {/* 3. KHU VỰC HÀNH ĐỘNG & THÔNG SỐ ĐÁNH TAY */}
       <div className="mt-5 pt-5 border-t border-slate-800 flex flex-col gap-3">
          {!logicGates.isApproved ? (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-[9px] p-2 rounded flex items-center gap-1.5 font-bold shadow-inner">
              <AlertTriangle className="w-3 h-3 shrink-0" /> LỆNH BỊ HỆ THỐNG KHÓA VÌ RỚT LOGIC GATES.
            </div>
          ) : (
            <div className="bg-emerald-950/20 border border-emerald-500/30 p-3 rounded text-[10px] shadow-inner">
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

          <button disabled={!logicGates.isApproved} onClick={handleSaveTradeLog} className={`w-full py-3 rounded-lg font-black text-[10px] tracking-widest flex items-center justify-center gap-2 transition-all duration-300 shadow-xl
              ${logicGates.isApproved ? 'bg-slate-800 text-white hover:bg-slate-700 border border-slate-600' : 'bg-slate-800/20 text-slate-700 border border-slate-800 cursor-not-allowed'}`}>
            <Save className="w-4 h-4"/> LƯU VÀO SỔ TAY SUPABASE
          </button>
       </div>
    </div>
  );
}
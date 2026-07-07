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
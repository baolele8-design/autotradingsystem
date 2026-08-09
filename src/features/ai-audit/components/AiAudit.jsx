// FILE: src/components/terminal/AiAudit.jsx
import React from 'react';
import { Bot, Database, Loader2, Cpu, LineChart, Target, ShieldAlert, History } from 'lucide-react';

export default function AiAudit({
  autoData,
  runQuantumCouncilAnalysis,
  isAnalyzing,
  geminiCooldown,
  councilReports,
  chiefDecision // Giờ là một JSON Object
}) {
  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col">
       <h2 className="text-[10px] font-bold text-blue-400 uppercase flex items-center gap-2 mb-3 border-b border-slate-800 pb-2">
         <Bot className="w-3.5 h-3.5" /> HỘI ĐỒNG LƯỢNG TỬ ĐA MÔ HÌNH (JSON MODE)
       </h2>
       
       <button 
         onClick={runQuantumCouncilAnalysis} 
         disabled={isAnalyzing || !autoData || geminiCooldown > 0} 
         className={`w-full py-2 mb-4 border rounded text-[10px] font-bold flex items-center justify-center gap-2 transition-all bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border-blue-500/30 ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : ''}`}
       >
         {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
         {isAnalyzing ? 'SERVERLESS ĐANG XỬ LÝ 8 LUỒNG...' : 'KÍCH HOẠT HỘI ĐỒNG (TỐI ƯU HÓA)'}
       </button>

       {councilReports && councilReports.length > 0 && (
         <div className="flex-grow overflow-y-auto pr-1 space-y-4" style={{ maxHeight: '500px', scrollbarWidth: 'thin', scrollbarColor: '#1e293b #0a0a0c' }}>
            
            {/* RENDER DỮ LIỆU TỪ 4 CẶP CHUYÊN GIA */}
            <div className="grid grid-cols-1 gap-2">
                {councilReports.map((rep, idx) => (
                    <div key={idx} className="bg-black/40 border border-slate-800 p-2 rounded relative">
                        <span className="absolute top-0 right-0 bg-slate-800 text-[6px] px-1.5 py-0.5 rounded-bl rounded-tr text-slate-400">{rep.model}</span>
                        <div className="text-[8.5px] font-bold text-cyan-500 mb-1">{rep.role}</div>
                        {rep.data.error ? (
                            <div className="text-[9px] text-red-500 font-mono">{rep.data.error}</div>
                        ) : (
                            <div className="text-[9px] font-mono text-slate-300">
                                <span className="text-amber-400 font-bold">Điểm Tín nhiệm: </span> {rep.data.score}<br/>
                                <span className="text-purple-400 font-bold">Lập luận: </span> {rep.data.reasoning}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* TỔNG TƯ LỆNH */}
            <div className="mt-4 pt-4 border-t border-emerald-900/50">
                <div className="text-[9px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1.5 mb-2"><ShieldAlert className="w-3.5 h-3.5"/> TỔNG TƯ LỆNH PHÁN QUYẾT</div>
                <div className="bg-emerald-950/20 border border-emerald-900/50 p-3 rounded">
                   {!chiefDecision ? (
                       <span className="text-slate-500 text-[10px] animate-pulse">Đang chờ phán quyết...</span>
                   ) : (
                       <div className="text-[10px] font-mono space-y-2">
                           <div className={`font-black text-lg ${chiefDecision.decision === 'DUYỆT' ? 'text-emerald-500' : 'text-red-500'}`}>
                               PHÁN QUYẾT: {chiefDecision.decision}
                           </div>
                           <div className="text-slate-300"><strong className="text-cyan-400">Tài sản:</strong> {chiefDecision.tier_classification}</div>
                           <div className="text-slate-300"><strong className="text-amber-400">Chiến thuật:</strong> {chiefDecision.suggested_strategy}</div>
                           <div className="text-slate-400 italic">"{chiefDecision.reasoning_summary}"</div>
                           <div className="bg-black/50 p-2 mt-2 border border-slate-700 rounded text-purple-300">
                               <strong>Tham số Tối ưu (Gợi ý):</strong><br/>
                               SL Mult: {chiefDecision.optimized_params?.suggested_slMult}x | 
                               TP Mult: {chiefDecision.optimized_params?.suggested_tpMult}x | 
                               Risk: {chiefDecision.optimized_params?.suggested_risk_pct}%
                           </div>
                       </div>
                   )}
                </div>
            </div>
         </div>
       )}
    </div>
  );
}
import React from 'react';
import { Crosshair, Loader2, Bell, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { getMinNotional } from '../../config/constants';

export default function MatrixScanner({
  scannedTopSetups,
  isScanningBackground,
  sonarEnabled,
  setSonarEnabled,
  injectScannedSetup
}) {
  return (
    <div className="max-w-7xl mx-auto mb-6">
      <div className="bg-[#111116] border border-emerald-900/50 rounded-xl p-4 shadow-xl">
        <div className="flex justify-between items-center border-b border-emerald-900/30 pb-2 mb-3">
          <h3 className="text-xs font-black text-emerald-400 flex items-center gap-2 tracking-widest uppercase">
            <Crosshair className="w-4 h-4 animate-pulse text-emerald-400" /> MATRIX SCANNER: ALPHA ASSETS (GATES PASSED)
          </h3>
          <div className="flex items-center gap-3 text-[9px] text-slate-500 font-mono">
            <button
              onClick={() => setSonarEnabled(!sonarEnabled)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-all ${
                sonarEnabled
                  ? 'bg-emerald-950 text-emerald-400 border-emerald-500/50'
                  : 'bg-slate-900 text-slate-500 border-slate-700'
              }`}
            >
              <Bell className={`w-3 h-3 ${sonarEnabled ? 'animate-bounce' : ''}`} />
              {sonarEnabled ? 'SONAR: ON' : 'SONAR: OFF'}
            </button>

            {isScanningBackground ? (
              <span className="flex items-center gap-1 text-amber-400 animate-pulse">
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> DEEP RE-INDEXING...
              </span>
            ) : (
              <span>40S/CYCLE</span>
            )}
          </div>
        </div>

        {scannedTopSetups.length === 0 ? (
          <div className="text-center py-4 text-slate-600 text-xs font-bold uppercase tracking-wider animate-pulse">
            Khởi động Động cơ Lượng tử, rà soát Logic Gates 45 vùng không gian...
          </div>
        ) : scannedTopSetups[0]?.isEmpty ? (
          <div className="text-center py-4 text-amber-500/80 bg-amber-950/10 border border-amber-900/30 rounded text-xs font-bold uppercase tracking-wider">
            ⚠️ KHÔNG CÓ SETUP NÀO ĐẠT TIÊU CHUẨN LOGIC GATES TRONG CHU KỲ NÀY. ĐỨNG NGOÀI LÀ BẢO VỆ VỐN.
          </div>
        ) : (
          <div
            className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-2"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#065f46 #0a0a0c' }}
          >
            {scannedTopSetups.map((setup, idx) => (
              <div
                key={idx}
                className="bg-black/40 border border-slate-800/80 rounded p-2.5 flex flex-col md:flex-row items-start md:items-center justify-between hover:border-emerald-500/40 hover:bg-black/60 transition-all group gap-3 md:gap-0"
              >
                <div className="flex items-center gap-3 w-full md:w-1/5">
                  <span
                    className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${
                      idx === 0
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-900/50'
                        : idx === 1
                        ? 'bg-blue-950 text-blue-400 border-blue-900/50'
                        : idx === 2
                        ? 'bg-purple-950 text-purple-400 border-purple-900/50'
                        : 'bg-slate-900 text-slate-400 border-slate-700'
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  <div>
                    <div className="text-xs font-black text-white flex items-center gap-1">
                      {setup.symbol}
                      {setup.overrideTag && (
                        <span className="text-[7.5px] font-black bg-purple-900/50 border border-purple-500/50 text-purple-400 px-1 rounded shadow-[0_0_8px_rgba(168,85,247,0.4)] animate-pulse">
                          {setup.overrideTag}
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] font-bold text-blue-400">{setup.interval}</div>
                  </div>
                </div>

                <div className="flex flex-col w-full md:w-1/4">
                  <div className="flex items-center gap-1 text-[10px] font-bold">
                    {setup.direction === 'LONG' ? (
                      <TrendingUp className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <TrendingDown className="w-3 h-3 text-red-500" />
                    )}
                    <span className={setup.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>
                      {setup.direction}
                    </span>
                  </div>
                  <div className="text-[9.5px] text-slate-400 font-mono mt-0.5">
                    E: <span className="text-white">${setup.entry}</span>{' '}
                    <span className="mx-1">|</span> S:{' '}
                    <span className="text-red-400">${setup.slTech}</span>
                  </div>
                </div>

                <div className="flex flex-col w-full md:w-1/4 font-mono">
                  <div className="text-[10.5px]">
                    <span className="text-slate-500">NET R:R</span>{' '}
                    <span className="text-emerald-400 font-black">1 : {setup.theoreticalRR}</span>
                  </div>
                  <div className="text-[9.5px] flex gap-3 mt-0.5">
                    <span>
                      RSI: <span className="text-cyan-400">{setup.rsi}</span>
                    </span>
                    <span>
                      CMF:{' '}
                      <span className={parseFloat(setup.cmf) > 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {setup.cmf}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="flex flex-row md:flex-col justify-between md:justify-start w-full md:w-1/6 font-mono text-[9.5px] text-slate-400">
                  <div>
                    Lev: <span className="text-amber-400 font-bold">{setup.suggestedLeverage}x</span>
                  </div>
                  <div>
                    Min Size: <span className="text-purple-400">${getMinNotional(setup.symbol)}</span>
                  </div>
                </div>

                <div className="w-full md:w-auto flex justify-end">
                  <button
                    onClick={() => injectScannedSetup(setup)}
                    className="text-[9px] bg-blue-950/50 hover:bg-blue-600/30 text-blue-400 font-bold px-3 py-1.5 rounded border border-blue-900/50 transition-colors flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 w-full md:w-auto"
                  >
                    <Zap className="w-3 h-3" /> <span>LOAD TO HUD</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
import QuantMath from '../../../domain/analytics/QuantMath.js';
import {
  encodeLiquidityLedgerEvent,
  withLiquidityFeatureVersion
} from '../../../domain/analytics/quant/liquidityMetadata.js';
import { numberOrNull } from '../../../domain/analytics/quant/indicatorPersistence.js';
import {
  decideExitReasonUpdate
} from './tradeLedgerExitReason.js';

export async function saveTradeLog(
  context,
  executionMetrics = { latency: 0, slippage: 0, exactEntry: null }
) {
  const {
    supabase,
    autoData,
    symbol,
    apiMacro,
    intervalTime,
    tradeSetup,
    mathCore,
    mvrvZScore,
    systemScore,
    vectorRegime,
    logicGates,
    liveCapital,
    systemVersion: SYSTEM_VERSION,
    currentEpochId,
    setTradeLogs,
    showToast
  } = context;
    if (!supabase) return;
    if (tradeSetup.strategyRolloutMode === 'PAPER_ONLY') {
      showToast('🧪 Chiến thuật mới đang ở PAPER/SHADOW; hãy dùng sổ Paper để thu thập mẫu.');
      return;
    }
    try {
      // (Bỏ toàn bộ các biến const compressedAutoData và fullSystemContext)
      
      const activeTierClass = QuantMath.classifyAssetTier(
          symbol, 
          autoData.usdVolume24h || 0,
          apiMacro.realSpreadPct
      );

      const payload = {
        symbol, interval: intervalTime, type: tradeSetup.tradeType, direction: tradeSetup.direction,
        entry: executionMetrics.exactEntry ? executionMetrics.exactEntry : parseFloat(tradeSetup.entry), 
        initial_entry: parseFloat(tradeSetup.entry),
        sl: parseFloat(tradeSetup.slTech), 
        tp_1_price: parseFloat(tradeSetup.tp1), 
        initial_sl: parseFloat(tradeSetup.slTech),
        initial_risk_per_coin: null,
        opened_at: null,
        protection_stage: 'NONE',
        high_water_price: null,
        high_water_r: 0,
        
        risk_amount_usd: Math.max(0.1, parseFloat(mathCore.riskAmountUSD)), 
        position_size_usd: parseFloat(mathCore.positionSizeUSD),
        rr: parseFloat(mathCore.theoreticalRR), 
        
        // --- CÁC CỘT THỐNG KÊ LÕI ---
        adx: parseFloat(autoData.adx),
        atr: parseFloat(autoData.atr14),
        rsi: parseFloat(autoData.rsi),
        cmf: parseFloat(autoData.cmf),
        bbw_rank: parseInt(autoData.bbwRank),
        oi_delta: parseFloat(autoData.oiDelta || 0),
        funding_rate: parseFloat(autoData.fundingRate),
        funding_slope: parseFloat(autoData.fundingSlope || 0),
        taker_ratio: parseFloat(apiMacro.takerBuySellRatio || 1),
        btc_dom_slope: parseFloat(autoData.btcDomSlope || 0),
        regime_at_entry: vectorRegime?.l2 || null,
        btc_regime_at_entry: vectorRegime?.btcRegime || null,
        mvrv: parseFloat(mvrvZScore),
        fgi: parseInt(apiMacro.fgiValue),

        // --- CÁC CỘT VI CẤU TRÚC VÀ RỦI RO (MỚI) ---
        vpin: parseFloat(autoData.vpinValue || 0),
        obi: parseFloat(autoData.obi || 0.5),
        // 2026-08-13: indicator missing → null (KHÔNG 0 — đồng bộ với
        // autoBot.js + scanner stamp; 0 confound gate đọc lại từ DB).
        amihud: numberOrNull(autoData.amihud),
        isi: numberOrNull(autoData.isi),
        // 🚀 BỔ SUNG 7 CỘT LƯỢNG TỬ MỚI VÀO ĐÂY:
        cvd_trend: numberOrNull(autoData.cvdTrend),
        vwap: numberOrNull(autoData.vwap),
        vwap_upper: numberOrNull(autoData.vwapUpper),
        vwap_lower: numberOrNull(autoData.vwapLower),
        hurst_value: numberOrNull(autoData.hurstValue),
        liq_longs_vol: numberOrNull(autoData.liqLongsVol),
        liq_shorts_vol: numberOrNull(autoData.liqShortsVol),
        // ------------------------------------------
        true_ev: parseFloat(mathCore.trueEVValue || 0),
        kelly_pct: parseFloat(mathCore.kellyPct || 0),
        trailing_activated: false, // Mặc định khi mở lệnh là False
        
        // --- BÓC TÁCH SOFT GATES (MỚI) ---
        gate_s1: systemScore.checks.checkS1 || false,
        gate_s2: systemScore.checks.checkS2 || false,
        gate_s3: systemScore.checks.checkS3 || false,
        gate_s4: systemScore.checks.checkS4 || false,
        gate_s5: systemScore.checks.checkS5 || false,
        gate_s6: systemScore.checks.checkS6 || false,
        gate_s7: systemScore.checks.checkS7 || false,
        gate_s8: systemScore.checks.checkS8 || false,

        trend_sma200: autoData.currentPrice > autoData.htfSma200 ? 'UP' : 'DOWN', 
        leverage: parseFloat(mathCore.suggestedLeverage), 
        status: 'PENDING', pnl_usd: 0, session: apiMacro.tradingSession,
        l1_structure: vectorRegime.details.l1,
        l2_volatility: vectorRegime.details.l2,
        l3_liq_event: encodeLiquidityLedgerEvent(
          vectorRegime.details.l3,
          autoData
        ),
        l4_positioning: vectorRegime.details.l4, l5_momentum: vectorRegime.details.l5, l6_macro: vectorRegime.details.l6,
        
        soft_score: parseFloat(logicGates.softScore), 
        holding_cycles: mathCore.tHold || 1, // Đã giữ lại theo yêu cầu
        planned_holding_cycles: mathCore.tHold || 1,
        actual_holding_cycles: null,
        strategy_id:
          tradeSetup.activeStrategyId ||
          tradeSetup.activeStrategy ||
          'ADAPTIVE_LONG_FALLBACK',
        strategy_name: tradeSetup.activeStrategyId || tradeSetup.activeStrategy || 'ADAPTIVE_LONG_FALLBACK',
        capital_at_entry_usd: parseFloat(liveCapital.toFixed(2)),
        strategy_version: withLiquidityFeatureVersion(
          `${SYSTEM_VERSION}|router-v1`
        ),
        applied_risk_pct: parseFloat(mathCore.appliedRiskPercent), 
        
        asset_tier: activeTierClass,
        epoch_id: currentEpochId || 'epoch-alpha-001', 
        slippage_usd: executionMetrics.slippage || 0,
        max_favorable_excursion_usd: 0, 
        max_adverse_excursion_usd: 0,
        metric_version: 'pending-live-ledger/v2',
        pee_analyzed: false
      };
      
      const { data, error } = await supabase.from('trade_logs').insert([payload]).select();
      if (error) {
          console.error("Lỗi Supabase Detail:", error);
          throw error;
      }
      if (data && data.length > 0) setTradeLogs(current => [data[0], ...current].slice(0, 300));
      showToast("☁️ ĐÃ LƯU SỔ TAY THÀNH CÔNG!");
    } catch (e) { 
        showToast(`❌ Lỗi Supabase: Kiểm tra Console F12 để xem chi tiết.`); 
    }
  };

export async function syncBinanceLedger(context, isSilent = false) {
  const {
    supabase,
    tradeLogs,
    setIsSyncing,
    showToast,
    fetchTradeLogs
  } = context;
    if (!supabase || !tradeLogs || tradeLogs.length === 0) return;
    setIsSyncing(true);
    
    try {
      if (!isSilent) showToast("🔄 Khởi chạy Kiểm toán Sổ cái Độc lập (Isolated Ledger Sync)...");
      const uniqueSymbols = [...new Set(tradeLogs.map(log => log.symbol))];
      let updatedCount = 0;
      const ts = Date.now();

      for (const sym of uniqueSymbols) {
          const symLogs = tradeLogs.filter(l => l.symbol === sym).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

          let binanceTrades = [];
          let openOrders = [];
          let binancePositions = [];
          
          // 1. NHẬN DIỆN LOẠI THỊ TRƯỜNG CỦA TOKEN
          const hasFutures = symLogs.some(l => l.type === 'FUTURES' || !l.type);
          const hasSpot = symLogs.some(l => l.type === 'SPOT');

          try {
              // 2. KÉO LỊCH SỬ FUTURES (Nếu có)
              if (hasFutures) {
                  const posRes = await fetch(`/api/binance?path=/fapi/v2/positionRisk&symbol=${sym}&isPrivate=true&t=${ts}`);
                  if (posRes.ok) {
                      binancePositions = await posRes.json();
                  }

                  const tradeRes = await fetch(`/api/binance?path=/fapi/v1/userTrades&symbol=${sym}&isPrivate=true&limit=1000&t=${ts}`);
                  if (tradeRes.ok) {
                      const data = await tradeRes.json();
                      binanceTrades.push(...data.map(d => ({ ...d, tradeType: 'FUTURES', normalizedSide: d.side })));
                  }
                  
                  const orderRes = await fetch(`/api/binance?path=/fapi/v1/openOrders&symbol=${sym}&isPrivate=true&t=${ts}`);
                  if (orderRes.ok) {
                      const data = await orderRes.json();
                      openOrders.push(...data.map(d => ({ ...d, tradeType: 'FUTURES' })));
                  }

                  const algoOrderRes = await fetch(`/api/binance?path=/fapi/v1/openAlgoOrders&symbol=${sym}&isPrivate=true&t=${ts}`);
                  if (algoOrderRes.ok) {
                      const data = await algoOrderRes.json();
                      openOrders.push(...data.map(d => ({
                          ...d,
                          type: d.orderType,
                          origType: d.orderType,
                          stopPrice: d.triggerPrice,
                          tradeType: 'FUTURES',
                          isAlgoOrder: true
                      })));
                  }
              }

              // 3. KÉO LỊCH SỬ SPOT (Nếu có)
              if (hasSpot) {
                  const tradeRes = await fetch(`/api/binance?path=/api/v3/myTrades&symbol=${sym}&isPrivate=true&limit=1000&t=${ts}`);
                  if (tradeRes.ok) {
                      const data = await tradeRes.json();
                      binanceTrades.push(...data.map(d => ({ ...d, tradeType: 'SPOT', normalizedSide: d.isBuyer ? 'BUY' : 'SELL' })));
                  }
                  
                  const orderRes = await fetch(`/api/binance?path=/api/v3/openOrders&symbol=${sym}&isPrivate=true&t=${ts}`);
                  if (orderRes.ok) {
                      const data = await orderRes.json();
                      openOrders.push(...data.map(d => ({ ...d, tradeType: 'SPOT' })));
                  }
              }
          } catch(e) { 
              // BỎ QUA LỖI 400 (DO TOKEN DELIST HOẶC FAKE) ĐỂ VÒNG LẶP KHÔNG BỊ CHẾT
              console.warn(`Bỏ qua đồng bộ ${sym} do API từ chối.`); 
              continue; 
          }

          // 4. XỬ LÝ ĐÓNG LỆNH CHO TỪNG DÒNG LOG
          for (let i = 0; i < symLogs.length; i++) {
              const log = symLogs[i];
              const currentPosition = binancePositions?.find(position => {
                  if (position.symbol !== sym) return false;
                  const amount = parseFloat(position.positionAmt);
                  if (!Number.isFinite(amount) || amount === 0) return false;
                  const positionSide = String(position.positionSide || 'BOTH').toUpperCase();
                  if (positionSide === 'LONG' || positionSide === 'SHORT') {
                      return positionSide === String(log.direction).toUpperCase();
                  }
                  return log.direction === 'LONG' ? amount > 0 : amount < 0;
              });
              const positionAmt = currentPosition ? parseFloat(currentPosition.positionAmt) : 0;
              const logTradeType = log.type || 'FUTURES';
              const logStartTime = new Date(log.created_at).getTime() - 60000; 
              const logEndTime = Date.now();

              // Lọc các giao dịch chỉ thuộc đúng thị trường (Spot/Futures)
              const cycleTrades = binanceTrades.filter(t => t.tradeType === logTradeType && t.time >= logStartTime && t.time <= logEndTime);

              const entrySide = log.direction === 'LONG' ? 'BUY' : 'SELL';
              const exitSide = log.direction === 'LONG' ? 'SELL' : 'BUY';
              
              const entryTrades = cycleTrades.filter(t => t.normalizedSide === entrySide);
              const closingTrades = cycleTrades.filter(t => t.normalizedSide === exitSide);

              // =========================================================
              // XỬ LÝ LỆNH CHỜ KHỚP (PENDING)
              // =========================================================
              if (log.status === 'PENDING') {
                 const isStillOpen = openOrders.some(o => o.tradeType === logTradeType && o.side === entrySide && Math.abs(parseFloat(o.price) - parseFloat(log.entry)) / parseFloat(log.entry) < 0.005);
                 
                 if (entryTrades.length > 0 || (logTradeType === 'FUTURES' && positionAmt !== 0 && !isStillOpen)) {
                     let exactEntryPrice = parseFloat(log.entry);
                     if (entryTrades.length > 0) {
                         const totalQty = entryTrades.reduce((sum, t) => sum + parseFloat(t.qty), 0);
                         exactEntryPrice = entryTrades.reduce((sum, t) => sum + (parseFloat(t.price) * parseFloat(t.qty)), 0) / totalQty;
                     }

                     const initialSl = parseFloat(log.initial_sl ?? log.sl);
                     const initialRiskPerCoin =
                       Math.abs(exactEntryPrice - initialSl);
                     const openUpdate = {
                       status: 'OPEN',
                       entry: exactEntryPrice,
                       opened_at: new Date().toISOString(),
                       high_water_price: exactEntryPrice,
                       high_water_r: 0,
                       protection_stage: log.protection_stage || 'NONE'
                     };
                     if (
                       Number.isFinite(initialSl) &&
                       initialSl > 0 &&
                       Number.isFinite(initialRiskPerCoin) &&
                       initialRiskPerCoin > 0
                     ) {
                       openUpdate.initial_sl = initialSl;
                       openUpdate.initial_risk_per_coin =
                         initialRiskPerCoin;
                     }
                     await supabase
                       .from('trade_logs')
                       .update(openUpdate)
                       .eq('id', log.id);
                     updatedCount++;
                 }
              } 
              // =========================================================
              // XỬ LÝ LỆNH ĐANG CHẠY (OPEN) VÀ TÍNH PNL CÁCH LY
              // =========================================================
              else if (log.status === 'OPEN' || log.status === 'CLOSED') {
                 const isPositionCleared = logTradeType === 'SPOT' ? true : positionAmt === 0;

                 if (closingTrades.length > 0 && isPositionCleared) {
                    const totalQty = closingTrades.reduce((sum, t) => sum + parseFloat(t.qty), 0);
                    const exitPrice = totalQty > 0 ? closingTrades.reduce((sum, t) => sum + (parseFloat(t.price) * parseFloat(t.qty)), 0) / totalQty : parseFloat(log.entry); 

                    const logSizeCoin = parseFloat(log.position_size_usd) / parseFloat(log.entry);
                    const logEntry = parseFloat(log.entry);
                    const rawIsolatedPnl = log.direction === 'LONG' ? (exitPrice - logEntry) * logSizeCoin : (logEntry - exitPrice) * logSizeCoin;
                    
                    const estimatedFee = (logSizeCoin * exitPrice) * 0.0004; 
                    const finalIsolatedPnl = rawIsolatedPnl - estimatedFee;

                    let preciseExitReason = 'MANUAL_CLOSE';
                    const tpPrice = parseFloat(log.tp_1_price);
                    const slPrice = parseFloat(log.sl);
                    const tolerance = exitPrice * 0.003; 

                    if (log.direction === 'LONG') {
                        if (exitPrice >= tpPrice - tolerance) preciseExitReason = 'TAKE_PROFIT_HIT';
                        else if (exitPrice <= slPrice + tolerance) preciseExitReason = 'STOP_LOSS_HIT';
                    } else {
                        if (exitPrice <= tpPrice + tolerance) preciseExitReason = 'TAKE_PROFIT_HIT';
                        else if (exitPrice >= slPrice - tolerance) preciseExitReason = 'STOP_LOSS_HIT';
                    }

                    const exitTime = new Date(closingTrades[closingTrades.length - 1].time);
                    // 🧠 THUẬT TOÁN TÍNH TOÁN DỮ LIỆU THẬT CHO HOLDING CYCLE
                    const INTERVAL_MS = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
                    const intervalMs = INTERVAL_MS[log.interval] || 3600000;
                    // Lấy Thời gian đóng - Thời gian mở / Khung giờ nến
                    const actualHoldingCycles = Math.max(1, Math.ceil((exitTime.getTime() - new Date(log.created_at).getTime()) / intervalMs));

                    // =========================================================
                    // 🧠 LÕI THUẬT TOÁN MFE/MAE THÍCH ỨNG (ADAPTIVE KLINES)
                    // =========================================================
                    let maxMfeUsd = 0;
                    let maxMaeUsd = 0;
                    
                    try {
                        const durationMs = exitTime.getTime() - logStartTime;
                        let klineInterval = '1m'; // Mặc định cho thời gian giữ ngắn (< 15h)
                        
                        // Co giãn khung thời gian tự động để bảo vệ Weight Limit (< 1000 nến)
                        if (durationMs > 10 * 24 * 60 * 60 * 1000) klineInterval = '1h';       // > 10 ngày
                        else if (durationMs > 3 * 24 * 60 * 60 * 1000) klineInterval = '15m'; // 3 - 10 ngày
                        else if (durationMs > 15 * 60 * 60 * 1000) klineInterval = '5m';      // 15h - 3 ngày

                        const basePath = logTradeType === 'SPOT' ? '/api/v3/klines' : '/fapi/v1/klines';
                        const klinesRes = await fetch(`/api/binance?path=${basePath}&symbol=${sym}&interval=${klineInterval}&startTime=${logStartTime}&endTime=${exitTime.getTime()}&limit=1500&t=${ts}`);
                        
                        if (klinesRes.ok) {
                            const klines = await klinesRes.json();
                            if (klines && klines.length > 0) {
                                // Quét mảng Klines để tìm đỉnh/đáy tuyệt đối trong quãng đời của lệnh
                                const absoluteHigh = Math.max(...klines.map(k => parseFloat(k[2])));
                                const absoluteLow = Math.min(...klines.map(k => parseFloat(k[3])));
                                
                                if (log.direction === 'LONG') {
                                    maxMfeUsd = Math.max(0, (absoluteHigh - logEntry) * logSizeCoin);
                                    maxMaeUsd = Math.min(0, (absoluteLow - logEntry) * logSizeCoin); // Ra số âm
                                } else {
                                    maxMfeUsd = Math.max(0, (logEntry - absoluteLow) * logSizeCoin);
                                    maxMaeUsd = Math.min(0, (logEntry - absoluteHigh) * logSizeCoin); // Ra số âm
                                }
                            }
                        }
                    } catch (err) {
                        console.warn(`[Klines Engine] Lỗi ngoại suy MAE/MFE cho ${sym}:`, err.message);
                    }
                    // =========================================================
           
                    await supabase.from('trade_logs').update({ 
                        status: finalIsolatedPnl > 0 ? 'WIN' : 'LOSS', 
                        pnl_usd: finalIsolatedPnl, 
                        close_price: exitPrice,
                        exit_reason: decideExitReasonUpdate(log, preciseExitReason), 
                        close_time: exitTime.toISOString(),
                        pee_analyzed: false,
                        max_favorable_excursion_usd: maxMfeUsd, 
                        max_adverse_excursion_usd: maxMaeUsd,
                        actual_holding_cycles: actualHoldingCycles,
                        metric_version: 'ui-ledger-excursion/v2'
                    })
                    // A1-2 RACE CLOSE: chỉ ghi khi row hiện tại exit_reason còn
                    // NULL hoặc MANUAL_CLOSE. Nếu daemon reconcile đã resolve
                    // trước đó (ghi reason thật), filter này không match row
                    // nào → UI không thể ghi đè reason/trạng thái của daemon.
                    .or('exit_reason.is.null,exit_reason.eq.MANUAL_CLOSE')
                    .eq('id', log.id);
                    
                    updatedCount++;

                    if (logTradeType === 'FUTURES') {
                        fetch('/api/cancel-orphans', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: log.symbol }) }).catch(e=>e);
                    }
                  // 🚀 BẢN VÁ TỐI THƯỢNG: QUÉT RÁC CÁC LỆNH BỊ KẸT MÀ API BINANCE TỪ CHỐI TRẢ VỀ
                 else if (log.status === 'CLOSED') {
                    const logEntry = parseFloat(log.entry);
                    const logSizeCoin = parseFloat(log.position_size_usd) / logEntry;
                    const fallbackExitPrice = log.close_price ? parseFloat(log.close_price) : logEntry;
                    
                    const rawIsolatedPnl = log.direction === 'LONG' 
                        ? (fallbackExitPrice - logEntry) * logSizeCoin 
                        : (logEntry - fallbackExitPrice) * logSizeCoin;
                    
                    const fallbackStatus = rawIsolatedPnl > 0 ? 'WIN' : (rawIsolatedPnl < 0 ? 'LOSS' : 'CANCELED');

                    await supabase.from('trade_logs').update({ 
                        status: fallbackStatus, 
                        pnl_usd: rawIsolatedPnl, 
                        exit_reason: log.exit_reason || 'FORCE_SYNC_RESOLVED', 
                        close_time: log.close_time || new Date().toISOString(),
                        pee_analyzed: false
                    }).eq('id', log.id);
                    
                    updatedCount++;
                 }
                 } else if (logTradeType === 'FUTURES' && positionAmt !== 0) { 
                    // [GIỮ NGUYÊN ĐOẠN NÀY ĐỂ TRACKING LIVE TRÊN GIAO DIỆN]
                    const markPrice = parseFloat(currentPosition?.markPrice || currentPosition?.entryPrice || log.entry);
                    const logSizeCoin = parseFloat(log.position_size_usd) / parseFloat(log.entry);
                    const livePnl = log.direction === 'LONG' 
                        ? (markPrice - parseFloat(log.entry)) * logSizeCoin 
                        : (parseFloat(log.entry) - markPrice) * logSizeCoin;
                        
                    let newMfe = log.max_favorable_excursion_usd || 0; 
                    let newMae = log.max_adverse_excursion_usd || 0;
                    let requiresUpdate = false;
                    
                    if (livePnl > newMfe) { newMfe = livePnl; requiresUpdate = true; }
                    if (livePnl < newMae) { newMae = livePnl; requiresUpdate = true; }

                    // 🚀 BẢN VÁ: ĐỒNG BỘ SL CHỈNH TAY TỪ BINANCE VỀ SUPABASE
                     const activeStopOrders = openOrders.filter(o => o.tradeType === 'FUTURES' && (o.type === 'STOP_MARKET' || o.origType === 'STOP_MARKET'));
                     if (activeStopOrders.length > 0) {
                         const expectedExitSide = log.direction === 'LONG' ? 'SELL' : 'BUY';
                         const matchingStops = activeStopOrders.filter(order => {
                             if (order.side !== expectedExitSide) return false;
                             const positionSide = String(order.positionSide || 'BOTH').toUpperCase();
                             return positionSide === 'BOTH' || positionSide === log.direction;
                         });
                         matchingStops.sort((left, right) => {
                             const leftPrice = parseFloat(left.stopPrice);
                             const rightPrice = parseFloat(right.stopPrice);
                             return log.direction === 'LONG'
                                 ? rightPrice - leftPrice
                                 : leftPrice - rightPrice;
                         });
                         const currentLiveSl = matchingStops[0];
                        
                        if (currentLiveSl && currentLiveSl.stopPrice) {
                            const liveSlPrice = parseFloat(currentLiveSl.stopPrice);
                            // Nhận diện SL bị lệch so với DB
                            if (Math.abs(liveSlPrice - parseFloat(log.sl)) > (parseFloat(log.sl) * 0.0005)) {
                                // Tự động xác định xem SL mới đã là mốc An Toàn chưa
                                const isSafe = log.direction === 'LONG' ? liveSlPrice >= parseFloat(log.entry) : liveSlPrice <= parseFloat(log.entry);
                                
                                 await supabase.from('trade_logs').update({ 
                                     sl: liveSlPrice,
                                     trailing_activated: isSafe || log.trailing_activated,
                                     protection_stage: isSafe
                                         ? (log.protection_stage || 'BE')
                                         : (log.protection_stage || 'NONE'),
                                     max_favorable_excursion_usd: newMfe,
                                    max_adverse_excursion_usd: newMae
                                }).eq('id', log.id);
                                requiresUpdate = false; // Đã gom update, ko cần update rời nữa
                            }
                        }
                    }

                    if (requiresUpdate) {
                        await supabase.from('trade_logs').update({ 
                            max_favorable_excursion_usd: newMfe, 
                            max_adverse_excursion_usd: newMae 
                        }).eq('id', log.id);
                    }
                 }
              }
          }
      }

      if (updatedCount > 0) {
          fetchTradeLogs();
          if (!isSilent) showToast(`✅ Deep Sync thành công! Xử lý chuẩn xác ${updatedCount} trạng thái lệnh.`);
      } else {
          if (!isSilent) showToast(`✅ Sổ cái hoàn hảo. Tuyệt đối không sai lệch.`);
      }

    } catch (e) { 
      if (!isSilent) showToast(`❌ Lỗi đồng bộ: ${e.message}`); 
    } finally { 
      setIsSyncing(false); 
    }
  };

export function createPaperTradingService(context) {
  const { safeFetch, supabase } = context;

  async function runLazyPaperTrading() {
      try {
          // 1. Kéo các lệnh ảo đang MỞ
          const { data: openPapers } = await supabase
              .from('paper_trade_logs')
              .select('*')
              .eq('status', 'OPEN');
  
          if (!openPapers || openPapers.length === 0) return;
  
          for (const trade of openPapers) {
              const openTimeMs = new Date(trade.created_at).getTime();
              
              // 2. Kéo nến từ lúc Mở lệnh đến hiện tại (Dùng limit=1000 để soi được xa nhất, tốn 5 weight)
              const klinesRes = await safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${trade.symbol}&interval=${trade.interval}&startTime=${openTimeMs}&limit=1000`);
              
              if (!klinesRes || klinesRes.length === 0) continue;
  
              let isClosed = false;
              let closePrice = 0;
              let exitReason = '';
              let closeTimeMs = openTimeMs;
              let finalHoldingCycles = 1;
  
              const entry = parseFloat(trade.entry);
              const sl = parseFloat(trade.sl);
              const tp = parseFloat(trade.tp_1_price);
  
              // 3. Thuật toán Replay: Quét từng nến từ quá khứ đến hiện tại
              for (let i = 0; i < klinesRes.length; i++) {
                  const candle = klinesRes[i];
                  const high = parseFloat(candle[2]);
                  const low = parseFloat(candle[3]);
                  const candleCloseTime = candle[6]; 
  
                  // Giả định khắc nghiệt (Worst-case Scenario): Luôn check SL trước TP trong cùng 1 nến
                  if (trade.direction === 'LONG') {
                      if (low <= sl) {
                          isClosed = true; closePrice = sl; exitReason = 'STOP_LOSS_HIT';
                          closeTimeMs = candleCloseTime; finalHoldingCycles = i + 1; break;
                      } else if (high >= tp) {
                          isClosed = true; closePrice = tp; exitReason = 'TAKE_PROFIT_HIT';
                          closeTimeMs = candleCloseTime; finalHoldingCycles = i + 1; break;
                      }
                  } else {
                      if (high >= sl) {
                          isClosed = true; closePrice = sl; exitReason = 'STOP_LOSS_HIT';
                          closeTimeMs = candleCloseTime; finalHoldingCycles = i + 1; break;
                      } else if (low <= tp) {
                          isClosed = true; closePrice = tp; exitReason = 'TAKE_PROFIT_HIT';
                          closeTimeMs = candleCloseTime; finalHoldingCycles = i + 1; break;
                      }
                  }
              }
  
              // 4. Cập nhật Database nếu lệnh chạm TP/SL
              if (isClosed) {
                  const sizeCoin = parseFloat(trade.position_size_usd) / entry;
                  const rawPnl = trade.direction === 'LONG' 
                      ? (closePrice - entry) * sizeCoin 
                      : (entry - closePrice) * sizeCoin;
                  
                  // Trừ phí ma sát ảo: Taker x 2 chiều (0.04% * 2) = 0.08%
                  const fee = (trade.position_size_usd * 0.0008); 
                  const finalPnl = rawPnl - fee;
  
                  await supabase.from('paper_trade_logs').update({
                      status: finalPnl > 0 ? 'WIN' : 'LOSS',
                      pnl_usd: finalPnl,
                      close_price: closePrice,
                      close_time: new Date(closeTimeMs).toISOString(),
                      exit_reason: exitReason,
                      holding_cycles: finalHoldingCycles
                  }).eq('id', trade.id);
                  
                  console.log(`👻 [PAPER TRADE] Lệnh ${trade.symbol} đã chốt! KQ: ${finalPnl > 0 ? 'WIN' : 'LOSS'} | H.Cycles: ${finalHoldingCycles} | Lãi/Lỗ: $${finalPnl.toFixed(2)}`);
              }
          }
      } catch (e) {
          console.error("❌ [PAPER ENGINE] Lỗi Hậu kiểm Lệnh Ảo:", e.message);
      }
  }
  
  // =====================================================================
  // 🔄 ĐỘNG CƠ ĐỒNG BỘ TRẠNG THÁI NGẦM (LEDGER STATE SYNC)
  // =====================================================================

  return { runLazyPaperTrading };
}

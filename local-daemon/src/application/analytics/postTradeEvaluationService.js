export const PEE_POLICY_VERSION = 'pee-window-3c-v2';

// PEE window cố định 2-3 nến theo khung lệnh (owner directive 2026-08-19).
// Ngắn lại so với phiên bản cũ (min(24, max(6, round(holding x 1.5))) = 6-24 nến)
// để kết quả PEE có sẵn nhanh hơn — 1d -> 3 ngày, 4h -> 12 giờ, 1h -> 3 giờ, 15m -> 45 phút.
// KHÔNG phụ thuộc holding cycles -> backfill được cho mọi lệnh (kể cả thiếu planned_holding_cycles).
export const PEE_WINDOW_CANDLES = 3;

export function calculatePeeWindowCandles() {
  return PEE_WINDOW_CANDLES;
}

export function getPeeWindowBounds(closeTimeMs, intervalMs, windowCandles) {
  const startTime = Math.ceil(closeTimeMs / intervalMs) * intervalMs;
  const endTime = startTime + windowCandles * intervalMs;
  return { endTime, matureAt: endTime, startTime };
}

export function createPostTradeEvaluationService(context) {
  const { batchSize = 10, safeFetch, supabase } = context;
  let activeRun = null;

  const INTERVAL_MS = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  
  async function executePostTradeEvaluation() {
      try {
          // Chỉ kéo những lệnh Đã Đóng nhưng chưa được phân tích (pee_analyzed = false)
          const { data: ripeTrades, error: ripeTradesError } = await supabase
              .from('trade_logs')
              .select(
                  'id, symbol, interval, direction, entry, close_price, ' +
                  'position_size_usd, close_time, planned_holding_cycles'
              )
              .in('status', ['WIN', 'LOSS'])
              .or(
                  `pee_analyzed.eq.false,pee_analyzed.is.null,` +
                  `pee_policy_version.is.null,` +
                  `pee_policy_version.neq.${PEE_POLICY_VERSION}`
              )
.not('close_time', 'is', null)
              .order('close_time', { ascending: true })
              .limit(batchSize);

          if (ripeTradesError) {
              throw new Error(`Không đọc được trade chờ PEE: ${ripeTradesError.message}`);
          }
  
          if (!ripeTrades || ripeTrades.length === 0) return;
  
          const now = Date.now();
          
          for (const trade of ripeTrades) {
              const closeTimeMs = Date.parse(trade.close_time || '');
              if (!Number.isFinite(closeTimeMs) || closeTimeMs <= 0) {
                  console.error(
                      `[PEE SKIP] ${trade.symbol} row=${trade.id} thiếu close_time hợp lệ.`
                  );
                  continue;
              }
const intervalMs = INTERVAL_MS[trade.interval] || 3600000;
              const peeWindowCandles = calculatePeeWindowCandles();
              
              const peeBounds = getPeeWindowBounds(
                  closeTimeMs,
                  intervalMs,
                  peeWindowCandles
              );
  
              if (now > peeBounds.matureAt) {
                  const klinesRes = await safeFetch(
                      'https://fapi.binance.com/fapi/v1/klines?' +
                      `symbol=${trade.symbol}&interval=${trade.interval}` +
                      `&startTime=${peeBounds.startTime}` +
                      `&endTime=${peeBounds.endTime}` +
                      `&limit=${peeWindowCandles}`
                  );
                  
                  const evaluationKlines = Array.isArray(klinesRes)
                      ? [...new Map(
                          klinesRes
                              .filter(kline => {
                                  const openTime = Number(kline?.[0]);
                                  return (
                                      Number.isFinite(openTime) &&
                                      openTime >= peeBounds.startTime &&
                                      openTime < peeBounds.endTime
                                  );
                              })
                              .map(kline => [Number(kline[0]), kline])
                      ).values()].sort(
                          (left, right) => Number(left[0]) - Number(right[0])
                      )
                      : [];
                  if (evaluationKlines.length === peeWindowCandles) {
                      const entryPrice = parseFloat(trade.entry);
                      const closePrice = parseFloat(trade.close_price || entryPrice);
                      const sizeCoins = parseFloat(trade.position_size_usd) / entryPrice;
                      if (
                          !Number.isFinite(entryPrice) ||
                          entryPrice <= 0 ||
                          !Number.isFinite(closePrice) ||
                          closePrice <= 0 ||
                          !Number.isFinite(sizeCoins) ||
                          sizeCoins <= 0
                      ) {
                          console.error(
                              `[PEE SKIP] ${trade.symbol} row=${trade.id} có entry/close/size không hợp lệ.`
                          );
                          continue;
                      }
  
                      let peeMfeUsd = 0; let peeMaeUsd = 0;
                      let peeMfeCandles = 0; let peeMaeCandles = 0;
  
                      let maxHigh = -Infinity; let maxHighIdx = 0;
                      let minLow = Infinity;   let minLowIdx = 0;
  
                      // Tìm giá trị và index của đỉnh/đáy trong tương lai
                      evaluationKlines.forEach((k, idx) => {
                          const high = parseFloat(k[2]); const low = parseFloat(k[3]);
                          if (high > maxHigh) { maxHigh = high; maxHighIdx = idx + 1; }
                          if (low < minLow) { minLow = low; minLowIdx = idx + 1; }
                      });
  
                      if (trade.direction === 'LONG') {
                          peeMfeUsd = Math.max(0, (maxHigh - closePrice) * sizeCoins);
                          peeMfeCandles = maxHighIdx; // Số nến để đạt đỉnh
                          
                          peeMaeUsd = Math.min(0, (minLow - closePrice) * sizeCoins);
                          peeMaeCandles = minLowIdx; // Số nến để chạm đáy
                      } else {
                          peeMfeUsd = Math.max(0, (closePrice - minLow) * sizeCoins);
                          peeMfeCandles = minLowIdx;
                          
                          peeMaeUsd = Math.min(0, (closePrice - maxHigh) * sizeCoins);
                          peeMaeCandles = maxHighIdx;
                      }
  
                      // Ghi lại kết quả vào Supabase (Bao gồm cả Cột Thời Gian)
                      const { error: updateError } =
                        await supabase.from('trade_logs').update({
                          pee_mfe_usd: peeMfeUsd,
                          pee_mae_usd: peeMaeUsd,
                          pee_mfe_candles: peeMfeCandles, // Dạy AI về Thời gian
                          pee_mae_candles: peeMaeCandles,
                          pee_window_candles: peeWindowCandles,
                          pee_policy_version: PEE_POLICY_VERSION,
                          pee_analyzed_at: new Date().toISOString(),
                          pee_analyzed: true
                      }).eq('id', trade.id);
                      if (updateError) throw updateError;
                      
                      console.log(`🔍 [PEE ENGINE] Khám nghiệm tử thi lệnh ${trade.symbol}. Lợi nhuận bỏ lỡ (MFE): $${peeMfeUsd.toFixed(2)}`);
                  } else {
                      console.warn(
                          `[PEE WAIT] ${trade.symbol} row=${trade.id} chỉ nhận được ` +
                          `${evaluationKlines.length}/` +
                          `${peeWindowCandles} nến hậu kiểm.`
                      );
                  }
              }
          }
      } catch (e) {
          console.error("❌ [PEE ENGINE] Lỗi phân tích Hậu giao dịch:", e.message);
          return { status: 'FAILED' };
      }
      return { status: 'COMPLETED' };
  }
  function runPostTradeEvaluation() {
      if (activeRun) return activeRun;
      activeRun = executePostTradeEvaluation()
          .finally(() => {
              activeRun = null;
          });
      return activeRun;
  }
  // =====================================================================
  // 👻 ĐỘNG CƠ HẬU KIỂM LỆNH ẢO (LAZY PAPER TRADING ENGINE)
  // =====================================================================

  return { runPostTradeEvaluation };
}

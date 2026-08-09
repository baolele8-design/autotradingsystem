import {
  getBinanceOrderType,
  isOwnedAlgoOrder,
  isStopLossOrder,
  isTakeProfitOrder
} from '../../domain/orders/trailingOrders.js';

export function createOrphanCleanupService(context) {
  const {
    readBinanceReq,
    sendBinanceReq,
    supabase,
    withSymbolOrderLock
  } = context;

  async function runOrphanCleanupEngine() {
      try {
          // 1. Kéo vị thế. Cảnh báo nếu API trả về null (Thường do lỗi IP/Timestamp/API Key)
          const positionsRes = await readBinanceReq('/fapi/v2/positionRisk');
          if (!positionsRes || !Array.isArray(positionsRes)) {
              console.error("❌ [LỖI API API] API /positionRisk trả về null. Hãy kiểm tra API Key Read-Only hoặc Đồng bộ giờ.");
              return;
          }
  
          // 2. Kéo toàn bộ lệnh treo
          const allStdOrders = await readBinanceReq('/fapi/v1/openOrders');
          const allAlgoOrders = await readBinanceReq('/fapi/v1/openAlgoOrders');
  
          if (!allStdOrders) console.error("❌ [LỖI API] API /openOrders trả về null.");
          if (!allAlgoOrders) console.error("❌ [LỖI API] API /openAlgoOrders trả về null.");
  
          const stdList = Array.isArray(allStdOrders) ? allStdOrders : (allStdOrders?.orders || []);
          const algoList = Array.isArray(allAlgoOrders) ? allAlgoOrders : (allAlgoOrders?.orders || []);
          const allOpenOrders = [...stdList, ...algoList];
          
          if (allOpenOrders.length === 0) return;

          // Legacy CO ownership is proven by the persisted Binance algoId.
          // If the ledger cannot be read, keep fail-closed behavior and only
          // recognize the explicit qts- client ID prefix.
          const ledgerReferences = new Map();
          if (supabase) {
              const { data: ledgerRows, error: ledgerError } = await supabase
                  .from('trade_logs')
                  .select('symbol,status,sl_algo_id,tp_algo_id');

              if (ledgerError) {
                  console.error(`❌ [ORPHAN OWNERSHIP] Không đọc được trade_logs: ${ledgerError.message}`);
              } else {
                  for (const row of ledgerRows || []) {
                      for (const [kind, algoId] of [
                          ['sl', row.sl_algo_id],
                          ['tp', row.tp_algo_id]
                      ]) {
                          if (algoId === null || algoId === undefined || algoId === '') continue;
                          ledgerReferences.set(String(algoId), {
                              kind,
                              status: String(row.status || '').toUpperCase(),
                              symbol: row.symbol
                          });
                      }
                  }
              }
          }

          const activeLedgerStatuses = new Set(['PENDING', 'OPEN', 'CLOSED']);
          const getLedgerReference = order =>
              order?.algoId === null || order?.algoId === undefined
                  ? null
                  : ledgerReferences.get(String(order.algoId)) || null;
          const isLedgerOwned = order => {
              const reference = getLedgerReference(order);
              return reference?.symbol === order.symbol;
          };
          const isResolvedLedgerOrder = order => {
              const reference = getLedgerReference(order);
              return (
                  reference?.symbol === order.symbol &&
                  !activeLedgerStatuses.has(reference.status)
              );
          };
  
          // Gom nhóm theo symbol
          const ordersBySymbol = {};
          for (const o of allOpenOrders) {
              if (!ordersBySymbol[o.symbol]) ordersBySymbol[o.symbol] = [];
              ordersBySymbol[o.symbol].push(o);
          }
  
          // --- HÀM XÓA LỆNH CHUYÊN SÂU KÈM BẮT LỖI ---
          const executeDelete = async (sym, order) => {
              try {
                  if (order.algoId) {
                      await sendBinanceReq('DELETE', '/fapi/v1/algoOrder', { symbol: sym, algoId: order.algoId });
                      console.log(`✅ [ĐÃ XÓA ALGO] ${sym} | ID: ${order.algoId} | Loại: ${getBinanceOrderType(order)}`);
                  } else if (order.orderId) {
                      await sendBinanceReq('DELETE', '/fapi/v1/order', { symbol: sym, orderId: order.orderId });
                      console.log(`✅ [ĐÃ XÓA STD] ${sym} | ID: ${order.orderId} | Loại: ${getBinanceOrderType(order)}`);
                  }
              } catch (err) {
                  // ÉP BINANCE PHẢI KHAI RA LÝ DO TỪ CHỐI
                  const errorCode = err.response?.data?.code || 'UNKNOWN';
                  const errorMsg = err.response?.data?.msg || err.message;
                  console.error(`🚨 [BINANCE TỪ CHỐI XÓA] ${sym} | ID: ${order.algoId || order.orderId} | Mã lỗi: ${errorCode} | Lý do: ${errorMsg}`);
              }
          };
  
          for (const sym of Object.keys(ordersBySymbol)) {
              const orders = ordersBySymbol[sym];
              const posAmt = positionsRes
                  .filter(position => position.symbol === sym)
                  .reduce(
                      (total, position) =>
                          total + Math.abs(Number.parseFloat(position.positionAmt) || 0),
                      0
                  );
  
              const entryOrders = [];
              const exitOrders = [];
  
              for (const o of orders) {
                  const isReduceOnly = o.reduceOnly === true || o.reduceOnly === "true";
                  const isExitOrder =
                      isStopLossOrder(o) ||
                      isTakeProfitOrder(o) ||
                      isReduceOnly;
  
                  if (!isExitOrder) {
                      entryOrders.push(o);
                  } else {
                      exitOrders.push(o);
                  }
              }
  
              // -------------------------------------------------------------
              // KỊCH BẢN 1: DỌN SẠCH RÁC MỒ CÔI (Khong Vị thế + Không Entry)
              // -------------------------------------------------------------
              if (posAmt === 0 && entryOrders.length === 0 && exitOrders.length > 0) {
                  const ownedOrphans = exitOrders.filter(order =>
                      isOwnedAlgoOrder(order) || isLedgerOwned(order)
                  );
                  if (ownedOrphans.length === 0) continue;
  
                  console.log(`\n🧹 [BẮT ĐẦU DỌN MỒ CÔI] ${sym} | Tìm thấy ${ownedOrphans.length} lệnh của engine.`);
                  await withSymbolOrderLock(sym, async () => {
                      for (const o of ownedOrphans) {
                          await executeDelete(sym, o);
                      }
                  });
                  continue;
              }
  
              if (posAmt === 0 && entryOrders.length > 0) {
                  continue; // Bảo vệ
              }
  
              // -------------------------------------------------------------
              // KỊCH BẢN 3: ĐANG CÓ VỊ THẾ -> CẮT TỈA TP/SL BỊ TRÙNG LẶP
              // -------------------------------------------------------------
              if (posAmt > 0) {
                  const resolvedTradeOrders = exitOrders.filter(isResolvedLedgerOrder);
                  if (resolvedTradeOrders.length > 0) {
                      console.log(`\n🧹 [DỌN CO TRADE ĐÃ KẾT THÚC] ${sym} | ${resolvedTradeOrders.length} lệnh có algoId khớp ledger.`);
                      await withSymbolOrderLock(sym, async () => {
                          for (const order of resolvedTradeOrders) {
                              await executeDelete(sym, order);
                          }
                      });
                  }

                  const remainingExitOrders = exitOrders.filter(
                      order => !resolvedTradeOrders.includes(order)
                  );
                  const slOrders = remainingExitOrders.filter(o =>
                      isOwnedAlgoOrder(o) && isStopLossOrder(o)
                  );
                  const tpOrders = remainingExitOrders.filter(o =>
                      isOwnedAlgoOrder(o) && isTakeProfitOrder(o)
                  );
  
                  if (slOrders.length > 1) {
                      console.log(`\n✂️ [CẮT TỈA SL] ${sym} | Phát hiện ${slOrders.length} SL đè nhau. Đang xóa đồ cũ...`);
                      slOrders.sort((a, b) =>
                          (b.createTime || b.time || b.updateTime || 0) -
                          (a.createTime || a.time || a.updateTime || 0)
                      );
                      const trash = slOrders.slice(1);
                      await withSymbolOrderLock(sym, async () => {
                          for (const o of trash) await executeDelete(sym, o);
                      });
                  }
  
                  if (tpOrders.length > 1) {
                      console.log(`\n✂️ [CẮT TỈA TP] ${sym} | Phát hiện ${tpOrders.length} TP đè nhau. Đang xóa đồ cũ...`);
                      tpOrders.sort((a, b) =>
                          (b.createTime || b.time || b.updateTime || 0) -
                          (a.createTime || a.time || a.updateTime || 0)
                      );
                      const trash = tpOrders.slice(1);
                      await withSymbolOrderLock(sym, async () => {
                          for (const o of trash) await executeDelete(sym, o);
                      });
                  }
              }
          }
      } catch (error) {
          console.error("🔥 [CRITICAL ERROR] Động cơ dọn dẹp sập toàn tập:", error.message);
      }
  }
  // =====================================================================
  // HỆ THỐNG CRONJOB ĐỆ QUY (CHỐNG RACE CONDITION TỐI ĐA)
  // =====================================================================
  
  // 1. Chạy ngầm Lệnh Ảo mỗi 5 phút (Sau khi tác vụ trước đã xong)

  return { runOrphanCleanupEngine };
}

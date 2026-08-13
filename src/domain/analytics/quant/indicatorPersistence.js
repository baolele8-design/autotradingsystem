// 2026-08-13: null-safe indicator persistence.
//
// Các cột indicator (vwap, vwap_upper, vwap_lower, cvd_trend, hurst_value,
// liq_longs_vol, liq_shorts_vol, amihud, isi...) được persist từ 3 nơi:
// autoBot.js payload, matrixScannerService stamp, tradeLedger (frontend).
// Trước đây dùng parseFloat(x || 0) → indicator MISSING bị bơm thành 0.
// 0 là giá trị thật nhưng làm confound mọi gate đọc lại từ DB:
//   - vwapUpper=0 → h_vwap chặn 100% LONG + pass 100% SHORT (confound hướng)
//   - hurst=0 → h_hurst fail-closed chặn nhầm trend-family
//   - cvd=0 → h_cvd fail-open méo
// Missing/invalid → null (gate phía đọc fail-open khi null — TradeValidator).
export const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
};

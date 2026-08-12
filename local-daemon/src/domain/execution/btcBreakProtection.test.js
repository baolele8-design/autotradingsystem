import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BTC_BREAK_BUFFER_BPS,
  BTC_BREAK_BURST_LIMIT,
  BTC_BREAK_CAP_R,
  BTC_BREAK_CONFIRM_CANDLES,
  BTC_BREAK_COOLDOWN_MS,
  BTC_BREAK_LOOKBACK_N,
  BTC_BREAK_STALE_TOLERANCE_MS,
  EXIT_REASON_BTC_BREAK,
  closedCandles,
  computeBtcBreakCapStop,
  computeSupportResistance,
  createBtcBreakCooldown,
  evaluateBtcBreak,
  hasBreakConfirmed,
  selectBtcBreakSymbols
} from './btcBreakProtection.js';

// kline = [openTime, open, high, low, close, volume, closeTime, ...]
const kline = (openTime, open, high, low, close, closeTime) => [
  openTime,
  String(open),
  String(high),
  String(low),
  String(close),
  '0',
  closeTime,
  '0',
  0,
  '0',
  '0',
  '0'
];

// Chuỗi nến 5m: nến cuối cùng có closeTime = anchor.
function buildSeries({ count = 25, anchor, prices = {} }) {
  const candles = [];
  const interval = 300000;
  for (let i = 0; i < count; i += 1) {
    const openTime = anchor - (count - i) * interval;
    const p = prices[i] || {};
    const o = p.o ?? 60000;
    const h = p.h ?? o;
    const l = p.l ?? o;
    const c = p.c ?? o;
    candles.push(kline(openTime, o, h, l, c, openTime + interval - 1));
  }
  return candles;
}

const supportBreakSeries = now =>
  buildSeries({
    anchor: now - 1000,
    prices: {
      23: { l: 59950, c: 59950 },
      24: { l: 59950, c: 59950 }
    }
  });

const resistanceBreakSeries = now =>
  buildSeries({
    anchor: now - 1000,
    prices: {
      23: { h: 60050, c: 60050 },
      24: { h: 60050, c: 60050 }
    }
  });

const noBreakSeries = now =>
  buildSeries({ anchor: now - 1000, prices: { 23: { c: 60020 }, 24: { c: 60020 } } });

test('các hằng số BTC break được chốt (lookback 20, confirm 2, buffer 5bps, cooldown 4h, burst 3, stale 5m30s)', () => {
  assert.equal(BTC_BREAK_LOOKBACK_N, 20);
  assert.equal(BTC_BREAK_CONFIRM_CANDLES, 2);
  assert.equal(BTC_BREAK_BUFFER_BPS, 5);
  assert.equal(BTC_BREAK_COOLDOWN_MS, 4 * 60 * 60 * 1000);
  assert.equal(BTC_BREAK_BURST_LIMIT, 3);
  assert.equal(BTC_BREAK_STALE_TOLERANCE_MS, 5 * 60_000 + 30_000);
  assert.equal(EXIT_REASON_BTC_BREAK, 'PORTFOLIO_TP_BTC_BREAK');
});

test('closedCandles giữ nến có closeTime <= now, loại nến chưa đóng', () => {
  const now = 1_000_000_000_000;
  const closed1 = kline(now - 600000, 1, 2, 3, 4, now - 300001);
  const closed2 = kline(now - 300000, 1, 2, 3, 4, now - 1);
  const open = kline(now, 1, 2, 3, 4, now + 300000);

  const result = closedCandles([closed1, open, closed2], now);
  assert.equal(result.length, 2);
  assert.equal(result[0][6], now - 300001);
  assert.equal(result[1][6], now - 1);

  assert.deepEqual(closedCandles([], now), []);
  assert.deepEqual(closedCandles(null, now), []);
});

test('computeSupportResistance dùng N nến đứng trước confirm candles; nến phá không hạ level', () => {
  const candles = [];
  let t = 1_000_000_000;
  for (let i = 0; i < 23; i += 1) {
    candles.push(kline(t, 60000, 60100, 59900, 60000, t + 299999));
    t += 300000;
  }
  // Nến thứ N+1 tính từ confirm (index 0): low/high cực trị — KHÔNG được ảnh hưởng
  candles[0][2] = '90000';
  candles[0][3] = '10000';
  // 2 nến phá (confirm): low quét sâu — KHÔNG được hạ support
  candles[21][3] = '50000';
  candles[22][3] = '50000';

  const sr = computeSupportResistance(candles);
  assert.equal(sr.support, 59900);
  assert.equal(sr.resistance, 60100);
});

test('computeSupportResistance trả null khi cửa sổ có ít hơn 2 nến', () => {
  const c1 = kline(0, 60000, 60100, 59900, 60000, 299999);
  const c2 = kline(300000, 60000, 60100, 59900, 60000, 599999);
  assert.equal(computeSupportResistance([]), null);
  assert.equal(computeSupportResistance([c1]), null);
  assert.equal(computeSupportResistance([c1, c2]), null);
});

test('hasBreakConfirmed: 2 nến đóng liên tiếp dưới support (qua buffer 5bps) → true', () => {
  const below = (close, low = close) => kline(0, 60000, 60000, low, close, 1);
  assert.equal(hasBreakConfirmed([below(59950), below(59950)], 60000, 'BELOW'), true);
});

test('hasBreakConfirmed: nến cuối đóng trên support → false dù nến trước đã phá', () => {
  const c = (close, low = close) => kline(0, 60000, 60000, low, close, 1);
  assert.equal(hasBreakConfirmed([c(59950), c(60020)], 60000, 'BELOW'), false);
});

test('hasBreakConfirmed: wick quét dưới nhưng close trên → false (chỉ tính close)', () => {
  const wick = (close, low) => kline(0, 60000, 60000, low, close, 1);
  assert.equal(hasBreakConfirmed([wick(60020, 59900), wick(60020, 59900)], 60000, 'BELOW'), false);
});

test('hasBreakConfirmed: buffer 5bps — close dưới support nhưng chưa đủ 5bps → false; đủ/đúng 5bps → true', () => {
  const c = (close, low = close) => kline(0, 60000, 60000, low, close, 1);
  assert.equal(hasBreakConfirmed([c(59980), c(59980)], 60000, 'BELOW'), false);
  assert.equal(hasBreakConfirmed([c(59970), c(59970)], 60000, 'BELOW'), true);
  assert.equal(hasBreakConfirmed([c(59950), c(59950)], 60000, 'BELOW'), true);
});

test('hasBreakConfirmed: 3 nến liên tiếp → true (chỉ cần ≥ confirm nến cuối)', () => {
  const c = (close, low = close) => kline(0, 60000, 60000, low, close, 1);
  assert.equal(hasBreakConfirmed([c(59950), c(59950), c(59950)], 60000, 'BELOW'), true);
});

test('hasBreakConfirmed: phá resistance phía trên dùng cùng buffer', () => {
  const c = (close, high = close) => kline(0, 60000, high, 60000, close, 1);
  assert.equal(hasBreakConfirmed([c(60050), c(60050)], 60000, 'ABOVE'), true);
  assert.equal(hasBreakConfirmed([c(60020), c(60020)], 60000, 'ABOVE'), false);
});

test('evaluateBtcBreak: support break → SUPPORT_BREAK; resistance break → RESISTANCE_BREAK; không → null', () => {
  const now = 2_000_000_000_000;

  const support = evaluateBtcBreak({ klines: supportBreakSeries(now), now });
  assert.equal(support.kind, 'SUPPORT_BREAK');
  assert.equal(support.support, 60000);
  assert.equal(support.resistance, 60000);

  const resistance = evaluateBtcBreak({ klines: resistanceBreakSeries(now), now });
  assert.equal(resistance.kind, 'RESISTANCE_BREAK');
  assert.equal(resistance.support, 60000);
  assert.equal(resistance.resistance, 60000);

  const none = evaluateBtcBreak({ klines: noBreakSeries(now), now });
  assert.equal(none.kind, null);
});

test('evaluateBtcBreak: stale — nến đóng cuối cũ hơn 5m30s → null dù giá dưới support', () => {
  const now = 2_000_000_000_000;
  const anchor = now - 1_000;
  const klines = supportBreakSeries(anchor);

  // Đánh giá ở thời điểm 400s sau nến đóng cuối (stale > 330s)
  const stale = evaluateBtcBreak({ klines, now: anchor + 400_000 });
  assert.equal(stale.kind, null);
});

test('evaluateBtcBreak: dưới 2 nến đóng hoặc klines rỗng → null (fail-closed)', () => {
  const now = 2_000_000_000_000;
  const single = [kline(now - 300000, 60000, 60000, 59900, 59900, now - 1)];
  assert.equal(evaluateBtcBreak({ klines: single, now }).kind, null);
  assert.equal(evaluateBtcBreak({ klines: [], now }).kind, null);
  assert.equal(evaluateBtcBreak({ klines: null, now }).kind, null);
});

test('selectBtcBreakSymbols lọc đúng chiều theo kind và chỉ giữ trade OPEN', () => {
  const candidates = [
    { symbol: 'AUSDT', pnl: 1 },
    { symbol: 'BUSDT', pnl: 2 },
    { symbol: 'CUSDT', pnl: 3 },
    { symbol: 'DUSDT', pnl: 4 }
  ];
  const trades = [
    { symbol: 'AUSDT', direction: 'LONG', status: 'OPEN' },
    { symbol: 'BUSDT', direction: 'SHORT', status: 'OPEN' },
    { symbol: 'CUSDT', direction: 'LONG', status: 'CLOSED' },
    { symbol: 'DUSDT', direction: 'LONG', status: 'OPEN' }
  ];

  assert.deepEqual(selectBtcBreakSymbols(candidates, trades, 'SUPPORT_BREAK'), [
    candidates[0],
    candidates[3]
  ]);
  assert.deepEqual(selectBtcBreakSymbols(candidates, trades, 'RESISTANCE_BREAK'), [
    candidates[1]
  ]);
  assert.deepEqual(selectBtcBreakSymbols(candidates, trades, null), []);
  assert.deepEqual(selectBtcBreakSymbols(null, trades, 'SUPPORT_BREAK'), []);
  assert.deepEqual(selectBtcBreakSymbols(candidates, null, 'SUPPORT_BREAK'), []);
});

test('createBtcBreakCooldown: chặn trong 4h, mở lại sau 4h, recordTrigger reset mốc', () => {
  let t = 1_000;
  const cooldown = createBtcBreakCooldown(4 * 60 * 60 * 1000, () => t);

  assert.equal(cooldown.canTrigger(), true);
  cooldown.recordTrigger();

  t += 3 * 60 * 60 * 1000;
  assert.equal(cooldown.canTrigger(), false);

  t += 1 * 60 * 60 * 1000; // đúng 4h kể từ mốc
  assert.equal(cooldown.canTrigger(), true);

  cooldown.recordTrigger();
  t += 1_000;
  assert.equal(cooldown.canTrigger(), false);

  const defaultCooldown = createBtcBreakCooldown();
  assert.equal(defaultCooldown.canTrigger(), true);
});

// =====================================================================
// F-D3: red-cap SL về 1R khi BTC break — computeBtcBreakCapStop
// =====================================================================

test('BTC_BREAK_CAP_R chốt bằng 1.0 (cap SL lệnh đỏ về 1R)', () => {
  assert.equal(BTC_BREAK_CAP_R, 1.0);
});

test('computeBtcBreakCapStop: LONG entry 100 risk 5 → SL cap 95 (entry - 1R)', () => {
  assert.equal(
    computeBtcBreakCapStop({ entry: 100, initialRiskPerCoin: 5, direction: 'LONG' }),
    95
  );
});

test('computeBtcBreakCapStop: SHORT entry 100 risk 5 → SL cap 105 (entry + 1R)', () => {
  assert.equal(
    computeBtcBreakCapStop({ entry: 100, initialRiskPerCoin: 5, direction: 'SHORT' }),
    105
  );
});

test('computeBtcBreakCapStop: capR tùy chỉnh 0.75 → 96.25 (cách entry đúng 0.75R)', () => {
  assert.equal(
    computeBtcBreakCapStop({ entry: 100, initialRiskPerCoin: 5, direction: 'LONG', capR: 0.75 }),
    96.25
  );
});

test('computeBtcBreakCapStop: input không hợp lệ → null (risk<=0, entry<=0, direction lạ, non-finite)', () => {
  assert.equal(computeBtcBreakCapStop({ entry: 100, initialRiskPerCoin: 0, direction: 'LONG' }), null);
  assert.equal(computeBtcBreakCapStop({ entry: 100, initialRiskPerCoin: -5, direction: 'LONG' }), null);
  assert.equal(computeBtcBreakCapStop({ entry: 0, initialRiskPerCoin: 5, direction: 'LONG' }), null);
  assert.equal(computeBtcBreakCapStop({ entry: -100, initialRiskPerCoin: 5, direction: 'LONG' }), null);
  assert.equal(computeBtcBreakCapStop({ entry: 100, initialRiskPerCoin: 5, direction: 'FLAT' }), null);
  assert.equal(computeBtcBreakCapStop({ entry: 100, initialRiskPerCoin: 5, direction: 'long' }), 95);
  assert.equal(computeBtcBreakCapStop({ entry: 'x', initialRiskPerCoin: 5, direction: 'LONG' }), null);
  assert.equal(computeBtcBreakCapStop({ entry: 100, initialRiskPerCoin: 5, direction: 'LONG', capR: 0 }), null);
  assert.equal(computeBtcBreakCapStop({}), null);
});

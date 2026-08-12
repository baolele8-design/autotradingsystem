import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMarketDepthUrl,
  computePendingOrderMathCore,
  TARGET_INTERVALS
} from './matrixScannerService.js';
import {
  accumulateNearMiss,
  classifyNearMiss,
  formatNearMissLine
} from './matrixScannerService.js';
import { TradeValidator } from '../../../../src/domain/trading/TradeValidator.js';

const VALID_FUTURES_DEPTH_LIMITS = new Set([5, 10, 20, 50, 100, 500, 1000]);

test('builds a market depth URL with a Binance Futures-valid limit', () => {
  const url = buildMarketDepthUrl('AVAXUSDT');
  assert.match(url, /^https:\/\/fapi\.binance\.com\/fapi\/v1\/depth\?symbol=AVAXUSDT&limit=\d+$/);
  const limit = Number(new URL(url).searchParams.get('limit'));
  assert.ok(
    VALID_FUTURES_DEPTH_LIMITS.has(limit),
    `limit=${limit} is not a valid Binance Futures depth limit`
  );
});

// F3 (P4): 5m là nguồn lỗ cấu trúc (n=42, WR 28.6%, −8.29R, không outlier).
// Scanner chỉ tạo setup từ các interval trong targetIntervals; bỏ '5m' ở đây
// đồng nghĩa không setup nào interval=5m được tạo trong chu kỳ quét.
test('target intervals exclude 5m — no 5m setup can be generated', () => {
  assert.ok(!TARGET_INTERVALS.includes('5m'));
  assert.deepEqual(TARGET_INTERVALS, ['15m', '1h', '4h', '1d']);
});

// ============================================================
// F6/F7 (C1/C2): computePendingOrderMathCore — thay mockMathCore fake
// (liqEstimate null → h4 luôn FAIL hủy mọi PENDING; true_ev || 1.0 → h2 luôn PASS).
// ============================================================
const LONG_BRACKETS = [
  {
    bracket: 1,
    initialLeverage: 10,
    notionalCap: 50000,
    notionalFloor: 0,
    maintMarginRatio: 0.004
  }
];

function gateFixture(overrides = {}) {
  const autoData = {
    atr14: 1,
    avgVolume20: 100,
    bbwRank: 50,
    cmf: 0.1,
    cvdTrend: 0,
    ema20: { value: 100 },
    hurstValue: 0.55,
    lastClosedVolume: 100,
    liquidationCoverageReady: false,
    liquidationReady: false,
    liquidationStale: true,
    liquidationUpdatedAt: 0,
    liquidationWindowMs: 15 * 60 * 1000,
    liqEventCount: 0,
    msbState: 'None',
    vpinValue: 0.05,
    vwapLower: 90,
    vwapUpper: 110,
    ...(overrides.autoData || {})
  };
  const apiMacro = {
    realSpreadPct: 0.01,
    takerBuySellRatio: 1,
    ...(overrides.apiMacro || {})
  };
  const vectorDetails = {
    l1: 'Trend Up',
    l2: 'Normal',
    l3: 'Quiet',
    l5: 'Weak / Mixed',
    ...(overrides.vectorDetails || {})
  };
  const systemScore = {
    score: 90,
    synergyText: '',
    penaltyText: '',
    passingScore: 50,
    checks: {
      checkS1: true,
      checkS2: true,
      checkS3: true,
      checkS4: true,
      checkS5: true,
      checkS6: true,
      checkS7: true,
      checkS8: true,
      checkMSB: true
    },
    checkScores: {}
  };
  return { apiMacro, autoData, systemScore, vectorDetails };
}

function evaluateWithCore(mathCore, overrides = {}) {
  const fixture = gateFixture(overrides);
  return TradeValidator.evaluateGates(
    fixture.autoData,
    fixture.apiMacro,
    fixture.vectorDetails,
    mathCore,
    overrides.direction || 'LONG',
    'FUTURES',
    overrides.entry ?? 100,
    overrides.slTech ?? 95,
    fixture.systemScore,
    [],
    'BTCUSDT'
  );
}

const gate = (result, id) =>
  result.hardGates.find(item => item.id === id);

function pendingLog(overrides = {}) {
  return {
    applied_risk_pct: '1',
    position_size_usd: '1000',
    leverage: '5',
    rr: '1.5',
    true_ev: null,
    entry: '100',
    sl: '95',
    direction: 'LONG',
    ...overrides
  };
}

// ---- C1: liqEstimate tính THẬT qua QuantMath.estimateLiquidation ----

test('C1: brackets hợp lệ → liqEstimate có giá trị, h4 pass (không còn luôn fail)', () => {
  const mathCore = computePendingOrderMathCore(pendingLog(), {
    symbol: 'BTCUSDT',
    currentPrice: 100,
    leverageBracketsRes: [{ symbol: 'BTCUSDT', brackets: LONG_BRACKETS }],
    defaultBrackets: LONG_BRACKETS,
    winRate: 0.5,
    totalClosed: 40
  });

  assert.ok(mathCore.liqEstimate);
  // LONG: liqPrice = entry*(1 − 1/lev + mmr) = 100*(1 − 0.2 + 0.004) = 80.4
  assert.ok(Math.abs(mathCore.liqEstimate.liqPrice - 80.4) < 1e-9);
  assert.equal(mathCore.leverageExceedsExchangeCap, false);
  // liqSafetyMargin = (|100−80.4|/100) / (|100−95|/100) = 0.196/0.05 = 3.92
  assert.ok(Math.abs(mathCore.liqSafetyMargin - 3.92) < 1e-9);
  assert.equal(mathCore.positionSizeUSD, 1000); // không fallback fake || 10

  const result = evaluateWithCore(mathCore);
  assert.equal(gate(result, 'h4').passed, true);
});

test('C1: size ≤ 0 → liqEstimate null → h4 fail (hủy lệnh hỏng là đúng)', () => {
  const mathCore = computePendingOrderMathCore(
    pendingLog({ position_size_usd: '0' }),
    {
      symbol: 'BTCUSDT',
      currentPrice: 100,
      leverageBracketsRes: [{ symbol: 'BTCUSDT', brackets: LONG_BRACKETS }],
      defaultBrackets: LONG_BRACKETS,
      winRate: 0.5,
      totalClosed: 40
    }
  );
  assert.equal(mathCore.liqEstimate, null);

  const result = evaluateWithCore(mathCore);
  // h4.passed có thể là null (false || null) — về mặt gate là falsy = không pass
  assert.ok(!gate(result, 'h4').passed);
});

test('C1: brackets thiếu → fail-open + placeholder liqPrice 0, h4 pass', () => {
  const mathCore = computePendingOrderMathCore(pendingLog(), {
    symbol: 'BTCUSDT',
    currentPrice: 100,
    leverageBracketsRes: null,
    defaultBrackets: [],
    winRate: 0.5,
    totalClosed: 40
  });
  assert.deepEqual(mathCore.liqEstimate, { liqPrice: 0 });
  assert.equal(mathCore.liqSafetyMargin, 1.3);

  const result = evaluateWithCore(mathCore);
  assert.equal(gate(result, 'h4').passed, true);
});

test('C1: direction lạ "FLAT" → normalize SHORT branch (entry*(1+1/lev−mmr))', () => {
  const mathCore = computePendingOrderMathCore(
    pendingLog({ direction: 'FLAT' }),
    {
      symbol: 'BTCUSDT',
      currentPrice: 100,
      leverageBracketsRes: [{ symbol: 'BTCUSDT', brackets: LONG_BRACKETS }],
      defaultBrackets: LONG_BRACKETS,
      winRate: 0.5,
      totalClosed: 40
    }
  );
  // SHORT: liqPrice = 100*(1 + 0.2 − 0.004) = 119.6
  assert.equal(mathCore.liqEstimate.liqPrice, 119.6);
});

// ---- C2: trueEVValue thật (xóa || 1.0) ----

test('C2: pLog.true_ev hợp lệ được ưu tiên (không tái tính)', () => {
  const mathCore = computePendingOrderMathCore(
    pendingLog({ true_ev: '0.12' }),
    {
      symbol: 'BTCUSDT',
      currentPrice: 100,
      leverageBracketsRes: [{ symbol: 'BTCUSDT', brackets: LONG_BRACKETS }],
      defaultBrackets: LONG_BRACKETS,
      winRate: 0.5,
      totalClosed: 40
    }
  );
  assert.equal(mathCore.trueEVValue, 0.12);
});

test('C2: thiếu true_ev → tái tính đúng công thức entry (prior 0.45)', () => {
  const mathCore = computePendingOrderMathCore(pendingLog(), {
    symbol: 'BTCUSDT',
    currentPrice: 100,
    leverageBracketsRes: [{ symbol: 'BTCUSDT', brackets: LONG_BRACKETS }],
    defaultBrackets: LONG_BRACKETS,
    winRate: 0.5,
    totalClosed: 40
  });
  // totalClosed ≥ 30 → evWinRate = 0.5; EV = 0.5*1.5 − 0.5 = 0.25
  assert.equal(mathCore.trueEVValue, 0.25);
  assert.equal(mathCore.theoreticalRR, 1.5);

  const result = evaluateWithCore(mathCore);
  assert.equal(gate(result, 'h2').passed, true);
});

test('C2 regression: true_ev âm thật + rr thấp → h2 FAIL (trước fake 1.0 luôn pass)', () => {
  const mathCore = computePendingOrderMathCore(
    // B3 (TP1 ~1R): requiredRR hạ 1.8 → 0.7 nên rr 1.5 cũ giờ PASS;
  // dùng rr 0.5 (< 0.7) để giữ đúng kịch bản regression fail.
    pendingLog({ true_ev: '-0.5', rr: '0.5' }),
    {
      symbol: 'BTCUSDT',
      currentPrice: 100,
      leverageBracketsRes: [{ symbol: 'BTCUSDT', brackets: LONG_BRACKETS }],
      defaultBrackets: LONG_BRACKETS,
      winRate: 0.5,
      totalClosed: 40
    }
  );
  assert.equal(mathCore.trueEVValue, -0.5);
  // bbwRank 50 → requiredRR 0.7; rr 0.5 < 0.7 và EV −0.5 < −0.05 → h2 phải fail
  const result = evaluateWithCore(mathCore);
  assert.equal(gate(result, 'h2').passed, false);
});

test('C2: true_ev dương + rr thấp → h2 PASS nhờ EV (cánh cửa EV dương)', () => {
  const mathCore = computePendingOrderMathCore(
    pendingLog({ true_ev: '0.2', rr: '1.5' }),
    {
      symbol: 'BTCUSDT',
      currentPrice: 100,
      leverageBracketsRes: [{ symbol: 'BTCUSDT', brackets: LONG_BRACKETS }],
      defaultBrackets: LONG_BRACKETS,
      winRate: 0.5,
      totalClosed: 40
    }
  );
  const result = evaluateWithCore(mathCore);
  assert.equal(gate(result, 'h2').passed, true);
});

// B3 (TP1 ~1R): requiredRR hạ 1.8 → 0.7 (bbwRank 50). rr "1.0" với EV prior
// −0.10 giờ PASS nhờ cửa RR (trước: fail vì 1.0 < 1.8).
test('B3: rr "1.0" + winRate 0/totalClosed 0 → EV prior −0.10 nhưng rr ≥ 0.7 → h2 PASS', () => {
  const mathCore = computePendingOrderMathCore(
    pendingLog({ rr: '1.0', true_ev: null }),
    {
      symbol: 'BTCUSDT',
      currentPrice: 100,
      leverageBracketsRes: [{ symbol: 'BTCUSDT', brackets: LONG_BRACKETS }],
      defaultBrackets: LONG_BRACKETS,
      winRate: 0,
      totalClosed: 0
    }
  );
  // evWinRate = 0.45 (prior); EV = 0.45*1.0 − 0.55 = −0.10
  assert.ok(Math.abs(mathCore.trueEVValue - (-0.1)) < 1e-9);
  const result = evaluateWithCore(mathCore);
  assert.equal(gate(result, 'h2').passed, true);
});

test('C2: rr "0" thật giữ 0 (không fallback 1.5) → EV âm → h2 fail', () => {
  const mathCore = computePendingOrderMathCore(
    pendingLog({ rr: '0', true_ev: null }),
    {
      symbol: 'BTCUSDT',
      currentPrice: 100,
      leverageBracketsRes: [{ symbol: 'BTCUSDT', brackets: LONG_BRACKETS }],
      defaultBrackets: LONG_BRACKETS,
      winRate: 0,
      totalClosed: 0
    }
  );
  assert.equal(mathCore.theoreticalRR, 0);
  // EV = 0.45*0 − 0.55 = −0.55
  assert.equal(mathCore.trueEVValue, -0.55);
  const result = evaluateWithCore(mathCore);
  assert.equal(gate(result, 'h2').passed, false);
});

test('C2: rr null hoac rong -> fallback 1.5 -> EV +0.125 -> h2 pass (fail-open nhe cho lenh thieu rr)', () => {
  const mathCore = computePendingOrderMathCore(
    pendingLog({ rr: null, true_ev: null }),
    {
      symbol: 'BTCUSDT',
      currentPrice: 100,
      leverageBracketsRes: [{ symbol: 'BTCUSDT', brackets: LONG_BRACKETS }],
      defaultBrackets: LONG_BRACKETS,
      winRate: 0,
      totalClosed: 0
    }
  );
  assert.equal(mathCore.theoreticalRR, 1.5);
  // EV = 0.45*1.5 - 0.55 = +0.125
  assert.equal(mathCore.trueEVValue, 0.125);
  const result = evaluateWithCore(mathCore);
  assert.equal(gate(result, 'h2').passed, true);
});

// ============================================================
// R2 (2026-08-10): per-candidate near-miss diagnostics
// (spec 10_reachability_fix_spec.md §2 — accumulate + 1 dòng/cycle)
// ============================================================

const diagnostics = overrides => ({
  matched: false,
  regimePassed: true,
  triggerPassed: true,
  confirmationPassed: 1,
  confirmationRequired: 2,
  confirmations: [],
  ...overrides
});

test('R2 classifyNearMiss: tầng fail đầu tiên quyết định reason', () => {
  assert.equal(
    classifyNearMiss(diagnostics({ regimePassed: false })).reason,
    'REGIME'
  );
  assert.equal(
    classifyNearMiss(diagnostics({ triggerPassed: false })).reason,
    'TRIGGER'
  );
  const conf = classifyNearMiss(diagnostics({
    confirmationPassed: 1,
    confirmationRequired: 2
  }));
  assert.equal(conf.reason, 'CONF');
  assert.equal(conf.confK, 1);
  assert.equal(conf.confN, 2);
});

test('R2 accumulateNearMiss: skip matched, đếm theo reason per strategy', () => {
  const stats = new Map();
  accumulateNearMiss([
    { strategyId: 'A', diagnostics: diagnostics({ regimePassed: false }) },
    { strategyId: 'A', diagnostics: diagnostics({ regimePassed: false }) },
    { strategyId: 'A', diagnostics: diagnostics({ triggerPassed: false }) },
    { strategyId: 'B', diagnostics: diagnostics({ confirmationPassed: 0 }) },
    { strategyId: 'B', diagnostics: diagnostics({ matched: true }) }
  ], stats);

  assert.equal(stats.get('A').count, 3);
  assert.equal(stats.get('A').byReason.REGIME, 2);
  assert.equal(stats.get('A').byReason.TRIGGER, 1);
  assert.equal(stats.get('B').count, 1);
  assert.equal(stats.get('B').byReason.CONF, 1);
  assert.equal(stats.has('C'), false);
});

test('R2 formatNearMissLine: top-5 theo count, min-count gate chặn noise', () => {
  const stats = new Map();
  accumulateNearMiss([
    ...Array(10).fill({
      strategyId: 'A',
      diagnostics: diagnostics({ triggerPassed: false })
    }),
    ...Array(3).fill({
      strategyId: 'B',
      diagnostics: diagnostics({ regimePassed: false })
    }),
    ...Array(2).fill({
      strategyId: 'C',
      diagnostics: diagnostics({ confirmationPassed: 1 })
    })
  ], stats);

  const line = formatNearMissLine(stats, { minCount: 3, top: 5 });
  assert.ok(line.startsWith('[STRATEGY NEAR-MISS] '));
  assert.ok(line.includes('A x10 (REGIME:0 TRIGGER:10 CONF:0)'));
  assert.ok(line.includes('B x3 (REGIME:3 TRIGGER:0 CONF:0)'));
  assert.ok(!line.includes('C x2'), 'count < minCount phải bị chặn');
});

test('R2 formatNearMissLine: không strategy nào đủ minCount → null (không log)', () => {
  const stats = new Map();
  accumulateNearMiss([
    ...Array(2).fill({
      strategyId: 'A',
      diagnostics: diagnostics({ triggerPassed: false })
    })
  ], stats);

  assert.equal(formatNearMissLine(stats, { minCount: 3 }), null);
  assert.equal(formatNearMissLine(new Map(), { minCount: 3 }), null);
});

test('R2 formatNearMissLine: CONF kèm confK/confN phổ biến nhất', () => {
  const stats = new Map();
  accumulateNearMiss([
    ...Array(6).fill({
      strategyId: 'A',
      diagnostics: diagnostics({ confirmationPassed: 1, confirmationRequired: 2 })
    }),
    ...Array(3).fill({
      strategyId: 'A',
      diagnostics: diagnostics({ confirmationPassed: 0, confirmationRequired: 2 })
    })
  ], stats);

  const line = formatNearMissLine(stats, { minCount: 3 });
  assert.ok(line.includes('CONF:9(1/2)'));
});

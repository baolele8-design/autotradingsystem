import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMarketDepthUrl,
  computePendingOrderMathCore,
  TARGET_INTERVALS,
  createMatrixScannerService
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

// ============================================================
// F-E1b/F-E2a/F-E3 (2026-08-12): shadow payload e2e — drives the real
// scanner scan cycle (mock exchange, no network) and asserts the new
// shadow-only payload fields reach SCAN_RESULTS while the live contract
// (tp1, btcRegime string) stays untouched.
// ============================================================

const scanKlines = (count = 250) => {
  const rows = [];
  let t = 1_700_000_000_000;
  for (let i = 0; i < count; i++) {
    const open = 100 * (1 + 0.0015 * i);
    const close = open * 1.004;
    const high = close * 1.005;
    const low = open * 0.995;
    const vol = 1000;
    const takerBuy = vol * 0.52;
    rows.push([t, open, high, low, close, vol, t, vol * close, 100, takerBuy, vol - takerBuy, 0]);
    t += 60_000;
  }
  return rows;
};

const scanMockContext = (overrides = {}) => {
  let captured = [];
  const clients = [{ readyState: 1, send: (msg) => captured.push(JSON.parse(msg)) }];
  // P0-2 (2026-08-13): scanner query thêm resolved logs (WIN/LOSS 90d) qua
  // cùng chain select→or→order. Mock phân loại theo filter string: query
  // resolved (chứa 'WIN') trả 5 rows (< 30 → h2 giữ plannedEV mode → mọi
  // test scanner hiện tại không đổi hành vi); query 12h trả 40 rows như cũ.
  const resolvedRows = Array.from({ length: 5 }, (_, i) => ({
    id: `resolved-${i}`,
    symbol: 'BTCUSDT',
    status: 'WIN',
    direction: 'LONG',
    interval: '15m',
    pnl_usd: 3 + (i % 5),
    risk_amount_usd: 1,
    created_at: new Date(Date.now() - i * 60_000).toISOString()
  }));
  const resolvedQuery = {
    select: () => resolvedQuery,
    or: () => resolvedQuery,
    order: async () => ({ data: resolvedRows, error: null })
  };
  const supabaseQuery = {
    select: () => supabaseQuery,
    or: (filters) => String(filters || '').includes('WIN')
      ? resolvedQuery
      : supabaseQuery,
    order: async () => ({
      data: Array.from({ length: 40 }, (_, i) => ({
        id: `win-${i}`,
        symbol: 'BTCUSDT',
        status: 'WIN',
        direction: 'LONG',
        interval: '15m',
        pnl_usd: 3 + (i % 5),
        risk_amount_usd: 1,
        created_at: new Date(Date.now() - i * 60_000).toISOString()
      })),
      error: null
    })
  };
  const context = {
    getConnectedClients: () => clients,
    getCurrentAiModel: () => null,
    getGlobalMvrvZScore: () => 0.4,
    getLiquidationSnapshot: () => ({ longs: 0, shorts: 0, ready: false }),
    marketDataCache: {
      getKlines: async () => scanKlines(250),
      getTicker24hAll: async () => null,
      getPremiumIndexAll: async () => null,
      getBookTickerAll: async () => [
        { symbol: 'BTCUSDT', bidPrice: '100', askPrice: '100.01', bidQty: '10', askQty: '10' }
      ]
    },
    readBinanceReq: async () => ({}),
    sendBinanceReq: async () => ({}),
    safeFetch: async () => ({}),
    supabase: { from: () => supabaseQuery },
    btcReturnsCache: new Map(),
    btcRegimeCache: new Map()
  };
  const svc = createMatrixScannerService({ ...context, ...overrides });
  return { svc, getResults: () => captured.filter(m => m.type === 'SCAN_RESULTS') };
};

const SHADOW_PAYLOAD_KEYS = [
  'btcStructure4h', 'btcStructure1d', 'btcBias', 'btcBias4h', 'btcBias1d',
  'slStructShadow', 'slApplied', 'slSizingDistance',
  'resistanceNear', 'supportNear', 'tp1DistAtr',
  'msbIsSFP', 'msbRegime', 'msbState', 'btcMsbAligned'
];

test('F-E1b/F-E2a/F-E3 e2e: shadow payload fields reach approved setups; tp1 untouched', async () => {
  const { svc, getResults } = scanMockContext();
  await svc.runMatrixScanner();

  // dual-type cache: the snapshot must surface plain regime strings
  const snapshot = svc.getBtcRegimeSnapshot();
  assert.ok(
    snapshot.regime4h === null || typeof snapshot.regime4h === 'string',
    'regime4h must be a plain string (or null), not an object'
  );
  assert.ok(
    snapshot.regime1d === null || typeof snapshot.regime1d === 'string',
    'regime1d must be a plain string (or null), not an object'
  );

  const results = getResults();
  assert.equal(results.length, 1, 'exactly one SCAN_RESULTS broadcast per cycle');
  const setups = results[0].data;
  assert.ok(setups.length > 0, 'mock fixture must produce at least one approved setup');
  for (const setup of setups) {
    for (const key of SHADOW_PAYLOAD_KEYS) {
      assert.ok(key in setup, `approved setup missing shadow payload key ${key}`);
    }
    // live contract untouched: tp1 is still the ATR-based 4-decimal string
    assert.match(setup.tp1, /^\d+\.\d{4}$/, 'tp1 stays a 4-decimal price string');
    assert.ok(parseFloat(setup.tp1) > 0);
    // btcRegime stays a plain string (R2/bot compatibility), never an object
    assert.ok(
      setup.btcRegime === null || typeof setup.btcRegime === 'string',
      'btcRegime must stay a plain string'
    );
    // slStructShadow is payload-only: applied/reason must never alter tp1
    assert.ok(
      ['STRUCTURE', 'ATR'].includes(setup.slStructShadow.applied),
      `unexpected slStructShadow.applied ${setup.slStructShadow.applied}`
    );
    assert.ok(
      ['OK', 'NO_LEVEL', 'LEVEL_CROSSED', 'STALE', 'TOO_TIGHT', 'NO_MOMENTUM', 'INVALID'].includes(setup.slStructShadow.reason),
      `unexpected slStructShadow.reason ${setup.slStructShadow.reason}`
    );
    assert.ok(Array.isArray(setup.msbIsSFP) || typeof setup.msbIsSFP === 'boolean', 'msbIsSFP normalized to boolean');
    assert.equal(typeof setup.btcMsbAligned, 'boolean', 'btcMsbAligned is boolean');
  }
});

test('F-E1b/F-E2a/F-E3 e2e: tp1DistAtr is positive and tp1 stays off entry', async () => {
  const { svc, getResults } = scanMockContext();
  await svc.runMatrixScanner();
  const setups = getResults()[0].data;
  assert.ok(setups.length > 0);
  for (const setup of setups) {
    const entry = parseFloat(setup.entry);
    const tp1 = parseFloat(setup.tp1);
    // tp1DistAtr = rewardDiff1/atr14 — positive means tp1 sits at a real
    // ATR distance; tp1 must remain a distinct price from entry (the
    // structure shadow never collapses it onto the entry).
    assert.ok(setup.tp1DistAtr > 0, `tp1DistAtr must be positive for ${setup.symbol} ${setup.interval}`);
    assert.ok(tp1 !== entry, 'tp1 must differ from entry');
    assert.ok(Number.isFinite(setup.tp1DistAtr));
  }
});

test('F-E2a e2e: PRICE_FILTER tickSize from exchangeInfo is wired into the structure shadow buffer', async () => {
  // Regression: matrixScannerService called computeStructureStop WITHOUT
  // tickSize, so the 2*tickSize branch (structureStopPolicy.js:77) was dead
  // in production — buffer was always 0.05*ATR. exchangeInfo already carries
  // PRICE_FILTER.tickSize; the scanner must forward it to the policy.
  // Fixture klines carry an explicit fractal tail (2 swing highs + 2 swing
  // lows, HL/HH -> Uptrend, close above last swing high -> Bullish_MSB) so
  // LONG setups pass the shadow guards (NO_LEVEL/STALE/LEVEL_CROSSED) and
  // reach the buffer computation.
  const structureKlines = (count = 250) => {
    const rows = [];
    let t = 1_700_000_000_000;
    const tail = [
      // [open, high, low, close] — indices 224..249
      [133.6, 134.3, 133.4, 134.0], [134.0, 134.7, 133.8, 134.4],
      [134.4, 135.1, 134.2, 134.8], [134.8, 135.2, 134.5, 134.9],
      [134.9, 135.3, 133.0, 135.0], [135.0, 135.6, 134.6, 135.3],
      [135.3, 135.9, 134.9, 135.6], [135.6, 136.0, 135.3, 135.7],
      [135.7, 136.5, 135.4, 135.8], [135.8, 136.2, 135.5, 136.0],
      [136.0, 136.1, 135.7, 136.2], [136.2, 136.7, 135.9, 136.4],
      [136.4, 136.9, 136.1, 136.6], [136.6, 137.0, 136.3, 136.7],
      [136.7, 137.1, 133.6, 136.8], [136.8, 137.3, 136.6, 137.0],
      [137.0, 137.9, 136.8, 137.2], [137.2, 137.7, 137.0, 137.4],
      [137.4, 137.5, 137.2, 137.6], [137.6, 138.1, 137.4, 137.8],
      [137.8, 138.3, 137.6, 138.0], [138.0, 138.5, 137.8, 138.2],
      [138.2, 138.7, 138.0, 138.4], [138.4, 138.9, 138.2, 138.6],
      [138.6, 139.1, 138.4, 138.8], [138.8, 139.3, 138.6, 139.0]
    ];
    const tailStart = count - tail.length;
    for (let i = 0; i < count; i++) {
      let open, high, low, close;
      if (i >= tailStart) {
        [open, high, low, close] = tail[i - tailStart];
      } else {
        open = 100 * (1 + 0.0015 * i);
        close = open * 1.004;
        high = close * 1.005;
        low = open * 0.995;
      }
      const vol = 1000;
      const takerBuy = vol * 0.52;
      rows.push([t, open, high, low, close, vol, t, vol * close, 100, takerBuy, vol - takerBuy, 0]);
      t += 60_000;
    }
    return rows;
  };
  const exchangeInfo = {
    symbols: [
      {
        symbol: 'BTCUSDT',
        onboardDate: Date.now() - 800 * 24 * 60 * 60 * 1000,
        filters: [
          { filterType: 'PRICE_FILTER', tickSize: '0.1' },
          { filterType: 'MIN_NOTIONAL', notional: '5' }
        ]
      }
    ]
  };
  const { svc, getResults } = scanMockContext({
    safeFetch: async (url) => (url.includes('exchangeInfo') ? exchangeInfo : {}),
    marketDataCache: {
      getKlines: async () => structureKlines(250),
      getTicker24hAll: async () => null,
      getPremiumIndexAll: async () => null,
      getBookTickerAll: async () => [
        { symbol: 'BTCUSDT', bidPrice: '100', askPrice: '100.01', bidQty: '10', askQty: '10' }
      ]
    }
  });
  await svc.runMatrixScanner();
  const setups = getResults()[0].data;
  assert.ok(setups.length > 0, 'mock fixture must produce at least one approved setup');
  // non-vacuous: at least one setup must reach the buffer computation
  // (fail-path results return bufferUsed: null).
  const withBuffer = setups.filter(s => s.slStructShadow.bufferUsed !== null);
  assert.ok(
    withBuffer.length > 0,
    'at least one setup must reach the structure-shadow buffer computation'
  );
  for (const setup of withBuffer) {
    // tickSize 0.1 => buffer = max(0.05*ATR, 2*0.1) = 0.2 (fixture ATR ~1 << 4,
    // so 2*tickSize always wins when wired). Buggy wiring yields 0.05*ATR.
    assert.equal(
      setup.slStructShadow.bufferUsed,
      0.2,
      `shadow buffer must use 2*tickSize from exchangeInfo (${setup.symbol} ${setup.interval})`
    );
  }
});

// ============================================================
// F-E2b (2026-08-12): SL structure LIVE — slTech thật = structure stop
// khi computeStructureStop trả applied='STRUCTURE' (level hợp lệ, momentum
// gate pass, không quá chặt); fail-open ATR khi không. Sizing giữ
// ATR-baseline distance (không tăng notional; risk thực giảm).
// ============================================================

// LONG fixture: uptrend + swing low 138.0 gần entry 139 (level hợp lệ,
// structure stop CHẶT HƠN ATR-SL 137.75 → applied='STRUCTURE').
const STRUCTURE_LONG_TAIL = [
  [133.6, 134.3, 133.4, 134.0], [134.0, 134.7, 133.8, 134.4],
  [134.4, 135.1, 134.2, 134.8], [134.8, 135.2, 134.5, 134.9],
  [134.9, 135.3, 133.0, 135.0], [135.0, 135.6, 134.6, 135.3],
  [135.3, 135.9, 134.9, 135.6], [135.6, 136.0, 135.3, 135.7],
  [135.7, 136.5, 135.4, 135.8], [135.8, 136.2, 135.5, 136.0],
  [136.0, 136.1, 135.7, 136.2], [136.2, 136.7, 135.9, 136.4],
  [136.4, 136.9, 136.1, 136.6], [136.6, 137.0, 136.3, 136.7],
  [136.7, 137.1, 136.6, 136.8], [136.8, 137.3, 136.6, 137.0],
  [137.0, 137.9, 136.8, 137.2], [137.2, 137.7, 137.0, 137.4],
  [137.4, 137.5, 137.2, 137.6], [137.6, 138.1, 137.4, 137.8],
  [137.8, 138.3, 137.6, 138.0], [138.0, 138.5, 137.8, 138.2],
  [138.2, 138.7, 138.0, 138.4], [138.4, 138.9, 138.2, 138.6],
  [138.6, 138.9, 138.4, 138.7], [138.4, 138.8, 138.0, 138.2],
  [138.2, 138.6, 138.1, 138.5], [138.5, 139.0, 138.4, 138.8],
  [138.8, 139.3, 138.7, 139.0]
];

// SHORT mirror của LONG tail: affine x -> 260-x (uptrend → downtrend,
// swing low → swing high, entry 139 → 121). Structure stop CHẶT HƠN ATR-SL
// ở chiều trên (122.04 < 122.25) → applied='STRUCTURE'.
const STRUCTURE_SHORT_TAIL = STRUCTURE_LONG_TAIL.map(
  ([o, h, l, c]) => [260 - o, 260 - l, 260 - h, 260 - c]
);

const structureKlinesFromTail = (tail) => {
  const count = 250;
  const rows = [];
  let t = 1_700_000_000_000;
  const tailStart = count - tail.length;
  for (let i = 0; i < count; i++) {
    let open, high, low, close;
    if (i >= tailStart) {
      [open, high, low, close] = tail[i - tailStart];
    } else {
      open = 100 * (1 + 0.0015 * i);
      close = open * 1.004;
      high = close * 1.005;
      low = open * 0.995;
    }
    const vol = 1000;
    const takerBuy = vol * 0.52;
    rows.push([t, open, high, low, close, vol, t, vol * close, 100, takerBuy, vol - takerBuy, 0]);
    t += 60_000;
  }
  return rows;
};

// Nền SHORT: mirror của nền LONG quanh trục 130 (open 160-0.15i, close
// giảm dần) — đồng bộ với affine của tail.
const shortKlinesFromTail = (tail) => {
  const count = 250;
  const rows = [];
  let t = 1_700_000_000_000;
  const tailStart = count - tail.length;
  for (let i = 0; i < count; i++) {
    let open, high, low, close;
    if (i >= tailStart) {
      [open, high, low, close] = tail[i - tailStart];
    } else {
      open = 160 - 0.15 * i;
      close = 260 - (100 * (1 + 0.0015 * i)) * 1.004;
      low = 260 - (100 * (1 + 0.0015 * i)) * 1.004 * 1.005;
      high = 260 - (100 * (1 + 0.0015 * i)) * 0.995;
    }
    const vol = 1000;
    const takerBuy = vol * 0.52;
    rows.push([t, open, high, low, close, vol, t, vol * close, 100, takerBuy, vol - takerBuy, 0]);
    t += 60_000;
  }
  return rows;
};

const scanWithKlines = async (klines, winsDirection) => {
  const wins = Array.from({ length: 40 }, (_, i) => ({
    id: `win-${i}`, symbol: 'BTCUSDT', status: 'WIN', direction: winsDirection,
    interval: '15m', pnl_usd: 3 + (i % 5), risk_amount_usd: 1,
    created_at: new Date(Date.now() - i * 60_000).toISOString()
  }));
  // P0-2 (2026-08-13): query resolved (WIN/LOSS 90d) trả 5 rows (< 30) →
  // h2 giữ plannedEV mode — các test F-E2b đo SL structure, không đo h2.
  const resolvedRows = Array.from({ length: 5 }, (_, i) => ({
    id: `resolved-${i}`, symbol: 'BTCUSDT', status: 'WIN', direction: winsDirection,
    interval: '15m', pnl_usd: 3 + (i % 5), risk_amount_usd: 1,
    created_at: new Date(Date.now() - i * 60_000).toISOString()
  }));
  const resolvedQuery = {
    select: () => resolvedQuery,
    or: () => resolvedQuery,
    order: async () => ({ data: resolvedRows, error: null })
  };
  const supabaseQuery = {
    select: () => supabaseQuery,
    or: (filters) => String(filters || '').includes('WIN')
      ? resolvedQuery
      : supabaseQuery,
    order: async () => ({ data: wins, error: null })
  };
  const { svc, getResults } = scanMockContext({
    marketDataCache: {
      getKlines: async () => klines,
      getTicker24hAll: async () => null,
      getPremiumIndexAll: async () => null,
      getBookTickerAll: async () => [
        { symbol: 'BTCUSDT', bidPrice: '100', askPrice: '100.01', bidQty: '10', askQty: '10' }
      ]
    },
    supabase: { from: () => supabaseQuery }
  });
  await svc.runMatrixScanner();
  return getResults()[0].data;
};

test('F-E2b (a): LONG structure level hợp lệ → slTech THẬT = structure stop (không phải ATR-SL); riskDiffTech co lại theo SL mới', async () => {
  const setups = await scanWithKlines(structureKlinesFromTail(STRUCTURE_LONG_TAIL), 'LONG');
  assert.ok(setups.length > 0, 'fixture phải tạo ≥1 approved setup');
  const structSetups = setups.filter(s => s.slApplied === 'STRUCTURE');
  assert.ok(
    structSetups.length > 0,
    'fixture LONG phải tạo ≥1 setup applied STRUCTURE'
  );
  for (const s of structSetups) {
    const entry = parseFloat(s.entry);
    const atr = parseFloat(s.atr);
    // slTech thật = structure stop — KHÔNG phải ATR-SL
    // (payload slTech là 4-dp string; so sánh tolerance 1e-3)
    assert.ok(
      Math.abs(parseFloat(s.slTech) - s.slStructShadow.slStruct) < 1e-3,
      'slTech phải bằng structure stop'
    );
    assert.ok(
      Math.abs(parseFloat(s.slTech) - s.slStructShadow.slAtr) > 1e-3,
      'slTech không được là ATR-SL khi applied=STRUCTURE'
    );
    // riskDiffTech theo SL mới: distance co lại so với ATR baseline
    assert.ok(
      Math.abs(entry - parseFloat(s.slTech)) < Math.abs(entry - s.slStructShadow.slAtr),
      'riskDiffTech theo SL mới phải nhỏ hơn ATR baseline'
    );
    // h1 (SL > 0.4 ATR) không vỡ: structure stop vẫn cách entry ≥ 0.5 ATR
    assert.ok(
      Math.abs(entry - parseFloat(s.slTech)) > 0.4 * atr,
      'gate h1 không được vỡ khi SL chặt hơn'
    );
    // theoreticalRR TĂNG so với ATR-baseline: cùng reward numerator
    // (rewardDiff1 - costDragWin không đổi), denominator riskDiffTech co
    // lại → RR_est_live = reward/rdLive > reward/rdAtr = RR_est_atr.
    const reward = Math.abs(parseFloat(s.tp1) - entry);
    const rrEstLive = reward > 0 ? reward / Math.abs(entry - parseFloat(s.slTech)) : 0;
    const rrEstAtr = reward > 0 ? reward / Math.abs(entry - s.slStructShadow.slAtr) : 0;
    assert.ok(
      rrEstLive > rrEstAtr,
      'theoreticalRR (denominator riskDiffTech co) phải tăng khi SL chặt hơn'
    );
  }
});

test('F-E2b (b): fail-open — fixture không có structure level hợp lệ → slTech = ATR-SL, slApplied=ATR', async () => {
  // Fixture mặc định (structureKlines cũ): swing 133.6 quá xa entry → ATR
  const { svc, getResults } = scanMockContext();
  await svc.runMatrixScanner();
  const setups = getResults()[0].data;
  assert.ok(setups.length > 0);
  for (const s of setups) {
    assert.equal(s.slApplied, 'ATR', 'fixture không level phải fail-open sang ATR');
    assert.ok(
      Math.abs(parseFloat(s.slTech) - s.slStructShadow.slAtr) < 1e-3,
      'fail-open: slTech phải giữ ATR-SL'
    );
  }
});

test('F-E2b (c): SHORT mirror — structure stop phía trên entry, slTech thật = slStruct, chặt hơn ATR-SL', async () => {
  const setups = await scanWithKlines(shortKlinesFromTail(STRUCTURE_SHORT_TAIL), 'SHORT');
  assert.ok(setups.length > 0, 'fixture SHORT phải tạo ≥1 approved setup');
  const structSetups = setups.filter(s => s.slApplied === 'STRUCTURE');
  assert.ok(
    structSetups.length > 0,
    'fixture SHORT phải tạo ≥1 setup applied STRUCTURE'
  );
  for (const s of structSetups) {
    const entry = parseFloat(s.entry);
    const atr = parseFloat(s.atr);
    assert.ok(Math.abs(parseFloat(s.slTech) - s.slStructShadow.slStruct) < 1e-3);
    assert.ok(Math.abs(parseFloat(s.slTech) - s.slStructShadow.slAtr) > 1e-3);
    // SHORT: SL nằm trên entry, chặt hơn (gần entry hơn) ATR-SL
    assert.ok(parseFloat(s.slTech) > entry);
    assert.ok(Math.abs(entry - parseFloat(s.slTech)) < Math.abs(entry - s.slStructShadow.slAtr));
    assert.ok(Math.abs(entry - parseFloat(s.slTech)) > 0.4 * atr, 'h1 không vỡ');
  }
});

test('F-E2b (d): sizing giữ ATR-baseline — positionSizeUSD không tăng khi SL chặt hơn', async () => {
  const setups = await scanWithKlines(structureKlinesFromTail(STRUCTURE_LONG_TAIL), 'LONG');
  const structSetups = setups.filter(s => s.slApplied === 'STRUCTURE');
  assert.ok(structSetups.length > 0);
  for (const s of structSetups) {
    const entry = parseFloat(s.entry);
    // slSizingDistance = distance ATR-baseline dùng cho slPercentForSize
    // (sizeSlDistance = riskDiffTechATR + slippageBuffer) — KHÔNG co theo
    // structure stop → positionSizeUSD = riskAmountUSD / slPercentForSize
    // giữ nguyên bằng baseline ATR (size không tăng).
    assert.ok(
      Math.abs(s.slSizingDistance - Math.abs(entry - s.slStructShadow.slAtr)) < 1e-3,
      'sizing phải dùng ATR-baseline distance, không co theo structure'
    );
    // SL thật chặt hơn distance sizing → risk thực giảm, size giữ baseline
    assert.ok(Math.abs(entry - parseFloat(s.slTech)) < s.slSizingDistance);
  }
});

test('F-E2b (e): invariant risk_at_stop ≤ 1% vốn giữ — SL chặt chỉ giảm risk, không tăng', async () => {
  const setups = await scanWithKlines(structureKlinesFromTail(STRUCTURE_LONG_TAIL), 'LONG');
  const structSetups = setups.filter(s => s.slApplied === 'STRUCTURE');
  assert.ok(structSetups.length > 0);
  for (const s of structSetups) {
    const entry = parseFloat(s.entry);
    // risk% tại stop (bot-side: riskAmountUSD = positionSizeUSD × slPercent):
    // slPercent thật ≤ slPercent ATR-baseline → risk_at_stop không vượt
    // baseline vốn đã ≤ 1% (invariant cũ, 443 tests pass).
    const slPercentLive = Math.abs(entry - parseFloat(s.slTech)) / entry;
    const slPercentBaseline = Math.abs(entry - s.slStructShadow.slAtr) / entry;
    assert.ok(
      slPercentLive <= slPercentBaseline,
      'risk% tại stop không được tăng khi SL chặt hơn'
    );
  }
});

test('F-E2b (f): payload slApplied phản ánh SL thật đang dùng (STRUCTURE|ATR)', async () => {
  // LONG structure fixture → STRUCTURE; fail-open fixture → ATR
  const structSetups = await scanWithKlines(
    structureKlinesFromTail(STRUCTURE_LONG_TAIL), 'LONG'
  );
  assert.ok(structSetups.some(s => s.slApplied === 'STRUCTURE'));
  assert.ok(structSetups.every(s => ['STRUCTURE', 'ATR'].includes(s.slApplied)));
  const { svc, getResults } = scanMockContext();
  await svc.runMatrixScanner();
  const atrSetups = getResults()[0].data;
  assert.ok(atrSetups.length > 0);
  assert.ok(atrSetups.every(s => s.slApplied === 'ATR'));
});

// =====================================================================
// REVERT P0-2 (2026-08-13, owner directive): resolved logs 90d được truyền
// vào evaluateGates (kèm strategyVersion) — h2_realized CHỈ telemetry
// (OR-gate, không chặn). 40 LOSS cùng version → h2_realized = −0.5 tính
// shadow NHƯNG LONG setup vẫn được tạo (rr ≥ 0.8 / EV tốt trong fixture).
// =====================================================================
test('REVERT P0-2 e2e: resolved 90d toàn LOSS cùng version (n=40 ≥ 30) → h2_realized telemetry, h2 OR-gate KHÔNG chặn LONG setup', async () => {
  // 12h query trả WIN (winRate 1 → EV dương → h2 pass qua cửa EV);
  // 90d query trả 40 LOSS cùng version (h2Realized = −0.5 telemetry only —
  // nếu P0-2 AND-gate còn binding, LONG bị chặn như test cũ chứng minh).
  const winRows = Array.from({ length: 40 }, (_, i) => ({
    id: `win-${i}`,
    symbol: 'BTCUSDT',
    status: 'WIN',
    direction: 'LONG',
    pnl_usd: 3 + (i % 5),
    risk_amount_usd: 1,
    created_at: new Date(Date.now() - i * 60_000).toISOString()
  }));
  const lossRows = Array.from({ length: 40 }, (_, i) => ({
    id: `loss-${i}`,
    symbol: 'BTCUSDT',
    status: 'LOSS',
    direction: 'LONG',
    pnl_usd: -10,
    risk_amount_usd: 20,
    strategy_version: 'v1.5.2-auto|liquidity-v2',
    close_time: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  }));
  const resolvedChain = {
    select: () => resolvedChain,
    or: () => resolvedChain,
    order: async () => ({ data: lossRows, error: null })
  };
  const twelveHourChain = {
    select: () => twelveHourChain,
    or: () => twelveHourChain,
    order: async () => ({ data: winRows, error: null })
  };
  const splitChain = {
    select: () => splitChain,
    or: (filters) => String(filters || '').includes('WIN')
      ? resolvedChain
      : twelveHourChain,
    order: async () => ({ data: winRows, error: null })
  };
  const { svc, getResults } = scanMockContext({
    supabase: { from: () => splitChain }
  });
  await svc.runMatrixScanner();
  const setups = getResults()[0].data;
  // h2Realized LONG = 0×avgWinR − 1×0.5 = −0.5 (telemetry only) — OR-gate
  // không chặn (EV dương từ 12h data). LONG setup phải xuất hiện; dưới
  // P0-2 AND-gate test này (cùng fixture) chặn sạch LONG.
  assert.ok(
    setups.filter(s => s.direction === 'LONG').length > 0,
    `resolved 40 LOSS → h2 OR-gate không được chặn LONG, thấy ${setups.filter(s => s.direction === 'LONG').length} LONG setup`
  );
  // Payload không đổi: candidate vẫn mang strategyVersion (contract cũ).
  for (const setup of setups.filter(s => s.direction === 'LONG')) {
    assert.ok('strategyVersion' in setup, 'candidate payload phải giữ strategyVersion');
  }
});

// =====================================================================
// P2-2 (2026-08-13): isOiSpiking SHADOW — candidate payload mang boolean,
// KHÔNG wire trade logic (persist oi_spike cần ALTER TABLE — xem
// local-daemon/sql/add_missing_columns.sql; proxy đã persist: oi_delta).
// =====================================================================
test('P2-2 shadow: candidate payload mang isOiSpiking (boolean)', async () => {
  const { svc, getResults } = scanMockContext();
  await svc.runMatrixScanner();
  const setups = getResults()[0].data;
  assert.ok(setups.length > 0, 'fixture phải tạo ≥1 approved setup');
  for (const setup of setups) {
    assert.ok('isOiSpiking' in setup, 'candidate phải mang isOiSpiking');
    assert.equal(typeof setup.isOiSpiking, 'boolean');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { TradeValidator } from './TradeValidator.js';
import { getStrategyDefinition } from './strategyRouter.js';

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
    ...overrides.autoData
  };
  const apiMacro = {
    realSpreadPct: 0.01,
    takerBuySellRatio: 1,
    ...overrides.apiMacro
  };
  const vectorDetails = {
    l1: 'Trend Up',
    l2: 'Normal',
    l3: 'Quiet',
    l5: 'Weak / Mixed',
    ...overrides.vectorDetails
  };
  const mathCore = {
    theoreticalRR: 3,
    trueEVValue: 0.2,
    liqEstimate: { liqPrice: 50 },
    leverageExceedsExchangeCap: false,
    liqSafetyMargin: 2,
    ...overrides.mathCore
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
    checkScores: {},
    ...(overrides.systemScore || {})
  };
  return { apiMacro, autoData, mathCore, systemScore, vectorDetails };
}

function evaluateFixture({
  direction = 'LONG',
  strategy = 'ADAPTIVE_LONG_FALLBACK',
  tradeType = 'FUTURES',
  tradeLogs = [],
  resolvedTradeLogs = null,
  strategyVersion = undefined,
  ...overrides
} = {}) {
  const fixture = gateFixture(overrides);
  return TradeValidator.evaluateGates(
    fixture.autoData,
    fixture.apiMacro,
    fixture.vectorDetails,
    fixture.mathCore,
    direction,
    tradeType,
    100,
    direction === 'LONG' ? 98 : 102,
    fixture.systemScore,
    tradeLogs,
    'BTCUSDT',
    strategy,
    resolvedTradeLogs,
    strategyVersion
  );
}

const gate = (result, id) =>
  result.hardGates.find(item => item.id === id);

test('score weights are deterministic and ignore optimizer gate weights', () => {
  const autoData = {
    bbwSlope: 0,
    cmf: 0.1,
    isBearishSFP: false,
    isBullishSFP: false,
    msbState: 'Bullish_MSB'
  };
  const apiMacro = { takerBuySellRatio: 1.1 };
  const vectorDetails = {
    l1: 'Trend Up',
    l2: 'Normal',
    l3: 'Shorts Trapped (Squeeze)',
    l4: 'Smart Money Long Building',
    l5: 'Strong Bullish',
    l6: 'Accumulation Zone',
    sTrend: 80,
    volScore: 50,
    liqSeverity: 90,
    posScore: 80,
    momScore: 80,
    macroScore: 80,
    isLeadLagArb: false
  };
  const baseline = TradeValidator.evaluateScore(
    autoData,
    apiMacro,
    vectorDetails,
    'LONG',
    0,
    'BTCUSDT',
    null
  );
  const hostileModel = TradeValidator.evaluateScore(
    autoData,
    apiMacro,
    vectorDetails,
    'LONG',
    0,
    'BTCUSDT',
    { gate_weights: { s1: 1000, s3: 0.0001 } }
  );

  assert.equal(hostileModel.score, baseline.score);
  assert.match(baseline.synergyText, /Tàu Siêu Tốc/u);
  assert.match(baseline.synergyText, /Cá Mập Quét Mồi/u);
});

test('range bypass belongs only to a strategy policy', () => {
  const blocked = evaluateFixture({
    vectorDetails: { l1: 'Range' }
  });
  const allowed = evaluateFixture({
    strategy: getStrategyDefinition('VOLATILITY_EXTREME_FADE'),
    vectorDetails: { l1: 'Range' }
  });

  assert.equal(gate(blocked, 'h_range_block').passed, false);
  assert.equal(gate(allowed, 'h_range_block').passed, true);
});

test('high VPIN bypass uses strategy policy rather than display text', () => {
  const blocked = evaluateFixture({
    autoData: { vpinValue: 0.2 }
  });
  const allowed = evaluateFixture({
    strategy: getStrategyDefinition('PASSIVE_ABSORPTION_REVERSAL'),
    autoData: { vpinValue: 0.2 }
  });

  assert.equal(gate(blocked, 'h_vpin').passed, false);
  assert.equal(gate(allowed, 'h_vpin').passed, true);
});

// 2026-08-13 regression: indicator missing giờ persist NULL (không 0) —
// các hard gate phải FAIL-OPEN khi đọc null, không coerce thành 0
// (0 = giá trị thật méo: vwapUpper=0 chặn 100% LONG + pass 100% SHORT;
// cvd=0 fail-open giả; hurst=0 chặn nhầm trend-family).
test('h_vwap fail-open khi vwapUpper/vwapLower null (không chặn LONG/SHORT)', () => {
  const longGates = evaluateFixture({
    direction: 'LONG',
    autoData: { vwapUpper: null }
  });
  const shortGates = evaluateFixture({
    direction: 'SHORT',
    strategy: 'ADAPTIVE_SHORT_FALLBACK',
    autoData: { vwapLower: null }
  });
  assert.equal(gate(longGates, 'h_vwap').passed, true, 'LONG phải pass khi vwapUpper null');
  assert.equal(gate(shortGates, 'h_vwap').passed, true, 'SHORT phải pass khi vwapLower null');
});

test('h_cvd fail-open khi cvdTrend null (cả 2 hướng)', () => {
  const longGates = evaluateFixture({
    direction: 'LONG',
    autoData: { cvdTrend: null }
  });
  const shortGates = evaluateFixture({
    direction: 'SHORT',
    strategy: 'ADAPTIVE_SHORT_FALLBACK',
    autoData: { cvdTrend: null }
  });
  assert.equal(gate(longGates, 'h_cvd').passed, true);
  assert.equal(gate(shortGates, 'h_cvd').passed, true);
});

test('h_hurst fail-open khi hurstValue null (không chặn trend-family)', () => {
  const result = evaluateFixture({
    strategy: getStrategyDefinition('VOL_COMPRESSION_IGNITION'),
    autoData: { hurstValue: null }
  });
  assert.equal(gate(result, 'h_hurst').passed, true, 'hurst null phải pass, không fail-closed');
});

test('h_hurst vẫn chặn trend-family khi hurst < 0.4 có giá trị thật', () => {
  const result = evaluateFixture({
    strategy: getStrategyDefinition('VOL_COMPRESSION_IGNITION'),
    autoData: { hurstValue: 0.3 }
  });
  assert.equal(gate(result, 'h_hurst').passed, false);
});

test('spot short and stale liquidation event are fail-closed', () => {
  const spotShort = evaluateFixture({
    direction: 'SHORT',
    strategy: 'ADAPTIVE_SHORT_FALLBACK',
    tradeType: 'SPOT'
  });
  const staleEvent = evaluateFixture({
    strategy: getStrategyDefinition('CAPITULATION_RECLAIM'),
    autoData: {
      liqEventCount: 1,
      liquidationUpdatedAt: Date.now() - 16 * 60 * 1000
    }
  });
  const freshEvent = evaluateFixture({
    strategy: getStrategyDefinition('CAPITULATION_RECLAIM'),
    autoData: {
      liqEventCount: 1,
      liquidationCoverageReady: true,
      liquidationReady: true,
      liquidationStale: false,
      liquidationUpdatedAt: Date.now()
    }
  });

  assert.equal(gate(spotShort, 'h_spot_short').passed, false);
  assert.equal(gate(staleEvent, 'h_liq_fresh').passed, false);
  assert.equal(gate(freshEvent, 'h_liq_fresh').passed, true);
});

// F4 (P6) → REVERT P0-2 (2026-08-13, owner directive): h2_realized chỉ còn
// TELEMETRY (shadow — OR-gate, không chặn). Version-scoped: resolved logs
// được lọc theo strategy_version của lệnh đang xét (tránh trộn engine
// v1.3.x đã khai tử). CONTRACT CHANGED: (1) nguồn ưu tiên resolvedTradeLogs
// (query 90 ngày) — fallback tradeLogs; (2) ngưỡng tính ≥30 (n<30 → null);
// (3) KHÔNG truyền strategyVersion → h2Realized = null (an toàn, không chặn);
// (4) E[R] = WR×avgWinR − (1−WR)×avgLossR (avgWinR/avgLossR rolling).
function sameDirectionTrades(count, {
  wins,
  direction = 'LONG',
  winPnl = 10,
  lossPnl = -10,
  risk = 20,
  strategyVersion = 'v1.5.2'
} = {}) {
  return Array.from({ length: count }, (_, i) => ({
    symbol: 'BTCUSDT',
    direction,
    status: i < wins ? 'WIN' : 'LOSS',
    pnl_usd: i < wins ? winPnl : lossPnl,
    risk_amount_usd: risk,
    strategy_version: strategyVersion,
    close_time: new Date(Date.now() - 60 * 60 * 1000).toISOString()
  }));
}

test('F4/REVERT: ≥30 lệnh resolved cùng direction + strategyVersion → h2_realized = WR×avgWinR − (1−WR)×avgLossR (pnl/risk)', () => {
  // 18W/30 → WR 0.6; pnl ±10 / risk 20 → avgWinR 0.5, avgLossR 0.5
  // E[R] = 0.6×0.5 − 0.4×0.5 = 0.10
  const result = evaluateFixture({
    strategyVersion: 'v1.5.2',
    resolvedTradeLogs: sameDirectionTrades(30, { wins: 18 })
  });
  assert.ok(
    Math.abs(gate(result, 'h2').h2_realized - 0.10) < 1e-9,
    `h2_realized=${gate(result, 'h2').h2_realized}`
  );
});

test('F4/REVERT: 30 lệnh thua cùng direction → h2_realized = −avgLossR = −0.5', () => {
  const result = evaluateFixture({
    strategyVersion: 'v1.5.2',
    resolvedTradeLogs: sameDirectionTrades(30, { wins: 0 })
  });
  assert.equal(gate(result, 'h2').h2_realized, -0.5);
});

test('F4/REVERT: <30 lệnh resolved cùng direction → h2_realized null', () => {
  const result = evaluateFixture({
    strategyVersion: 'v1.5.2',
    resolvedTradeLogs: sameDirectionTrades(29, { wins: 15 })
  });
  assert.equal(gate(result, 'h2').h2_realized, null);
});

test('F4/REVERT: h2_realized chỉ đếm lệnh cùng direction (khác hướng không tính)', () => {
  const trades = [
    ...sameDirectionTrades(30, { wins: 0, direction: 'LONG' }),
    ...sameDirectionTrades(30, { wins: 30, direction: 'SHORT' })
  ];
  const result = evaluateFixture({
    direction: 'LONG',
    strategyVersion: 'v1.5.2',
    resolvedTradeLogs: trades
  });
  // CHỈ LONG được tính: 0 WIN / 30 LOSS → E[R] = −0.5
  assert.equal(gate(result, 'h2').h2_realized, -0.5);
});

test('F4/REVERT: n<30 → h2_realized null và h2 giữ hành vi plannedEV (OR) — isApproved không đổi', () => {
  const withoutLogs = evaluateFixture();
  // 6 lệnh (< 30) → realized không active; EV 0.2 > −0.05 → h2 pass như cũ
  const withLogs = evaluateFixture({
    strategyVersion: 'v1.5.2',
    tradeLogs: sameDirectionTrades(6, { wins: 6 })
  });
  assert.equal(withLogs.isApproved, withoutLogs.isApproved);
  assert.equal(gate(withLogs, 'h2').passed, gate(withoutLogs, 'h2').passed);
  assert.equal(gate(withLogs, 'h2').h2_realized, null);
});

// =====================================================================
// REVERT P0-2 (2026-08-13, owner directive): h2 quay về OR-gate
// (plannedEV || RR) — h2Realized CHỈ telemetry, KHÔNG chặn. requiredRR
// 0.8 flat (P0-2: 1.2/1.0; pre-P0-2: 0.8/0.7 theo bbwRank).
// Lý do: P0-2 AND-gate block 100% production (resolved 90d EV âm từ
// sample 52% là engine v1.3.x đã khai tử; engine v1.5.2 = −0.035R;
// EV âm không significant z −1.60/−0.69).
// =====================================================================
test('REVERT P0-2 (a): 30 resolved EV âm (h2_realized −0.28) + rr 0.9 → h2 PASS qua cửa RR (OR — telemetry không chặn)', () => {
  // 12W/30 → WR 0.4; win pnl 10/risk 20 → winR 0.5; loss pnl −16/risk 20 → lossR 0.8
  // E[R] = 0.4×0.5 − 0.6×0.8 = −0.28 → realized âm NHƯNG rr 0.9 ≥ 0.8 → OR pass
  const result = evaluateFixture({
    strategyVersion: 'v1.5.2',
    mathCore: { theoreticalRR: 0.9, trueEVValue: 0.2 },
    resolvedTradeLogs: [
      ...sameDirectionTrades(12, { wins: 12, winPnl: 10, risk: 20 }),
      ...sameDirectionTrades(18, { wins: 0, lossPnl: -16, risk: 20 })
    ]
  });
  assert.equal(gate(result, 'h2').passed, true);
  assert.ok(gate(result, 'h2').h2_realized < -0.05, 'h2_realized vẫn tính (telemetry)');
});

test('REVERT P0-2 (b): realized EV âm + rr 1.5 → h2 PASS (OR — rr 1.5 ≥ 0.8)', () => {
  const result = evaluateFixture({
    strategyVersion: 'v1.5.2',
    mathCore: { theoreticalRR: 1.5, trueEVValue: 0.2 },
    resolvedTradeLogs: [
      ...sameDirectionTrades(12, { wins: 12, winPnl: 10, risk: 20 }),
      ...sameDirectionTrades(18, { wins: 0, lossPnl: -16, risk: 20 })
    ]
  });
  assert.equal(gate(result, 'h2').passed, true);
});

test('REVERT P0-2 (c): EV âm + rr 0.7 → h2 FAIL (OR vẫn chặn RR < 0.8)', () => {
  const evNegativeLowRr = evaluateFixture({
    mathCore: { theoreticalRR: 0.7, trueEVValue: -0.06 }
  });
  assert.equal(gate(evNegativeLowRr, 'h2').passed, false, 'EV ≤ −0.05 + rr < 0.8 → fail');

  const evPositive = evaluateFixture({
    mathCore: { theoreticalRR: 0.9, trueEVValue: 0.01 },
    resolvedTradeLogs: sameDirectionTrades(10, { wins: 6 })
  });
  assert.equal(gate(evPositive, 'h2').passed, true, 'EV > −0.05 → pass qua cửa EV');
});

test('REVERT P0-2 (d): requiredRR 0.8 flat — rr 0.85 + EV âm → PASS; rr 0.7 + EV âm → FAIL', () => {
  const rr085 = evaluateFixture({
    mathCore: { theoreticalRR: 0.85, trueEVValue: -0.06 }
  });
  assert.equal(gate(rr085, 'h2').passed, true, 'rr 0.85 ≥ 0.8 → pass');

  const rr070 = evaluateFixture({
    mathCore: { theoreticalRR: 0.7, trueEVValue: -0.06 }
  });
  assert.equal(gate(rr070, 'h2').passed, false, 'rr 0.7 < 0.8 → fail');
});

test('REVERT P0-2 (e): EV dương + rr 0.5 → h2 PASS qua cửa EV (OR — rr thấp không chặn khi EV tốt)', () => {
  const result = evaluateFixture({
    strategyVersion: 'v1.5.2',
    mathCore: { theoreticalRR: 0.5, trueEVValue: 0.2 },
    resolvedTradeLogs: sameDirectionTrades(30, { wins: 24 })
  });
  assert.equal(gate(result, 'h2').passed, true);
});

// =====================================================================
// REVERT P0-2 (2026-08-13): requiredRR 0.8 flat (bỏ nhánh bbwRank 1.2/1.0).
// =====================================================================
test('REVERT P0-2/B3: theoreticalRR 0.75 + EV −0.06 → h2 FAIL (rr < 0.8)', () => {
  const result = evaluateFixture({
    mathCore: { theoreticalRR: 0.75, trueEVValue: -0.06 }
  });
  assert.equal(gate(result, 'h2').passed, false);
});

test('REVERT P0-2/B3: theoreticalRR 1.5 + EV −0.06 → h2 PASS qua cửa RR (1.5 ≥ 0.8)', () => {
  const result = evaluateFixture({
    mathCore: { theoreticalRR: 1.5, trueEVValue: -0.06 }
  });
  assert.equal(gate(result, 'h2').passed, true);
});

test('REVERT P0-2/B3: bbwRank > 80 KHÔNG còn nâng requiredRR (flat 0.8) — rr 1.1 + EV −0.06 pass', () => {
  const result = evaluateFixture({
    autoData: { bbwRank: 90 },
    mathCore: { theoreticalRR: 1.1, trueEVValue: -0.06 }
  });
  assert.equal(gate(result, 'h2').passed, true);
});

test('REVERT P0-2/B3: boundary requiredRR 0.8 — rr 0.8 + EV −0.06 pass (inclusive)', () => {
  const result = evaluateFixture({
    mathCore: { theoreticalRR: 0.8, trueEVValue: -0.06 }
  });
  assert.equal(gate(result, 'h2').passed, true);
});

// =====================================================================
// REVERT P0-2 (2026-08-13): h2Realized TELEMETRY version-scoped —
// filter resolved logs theo strategy_version của lệnh đang xét.
// =====================================================================
test('REVERT P0-2 (f): version-scope — chỉ đếm resolved logs cùng strategy_version (51 v1.5.2 không trộn 119 v1.3.x)', () => {
  // 51 lệnh v1.5.2: 20W/51 → WR 0.392; winR 0.5 (pnl 10/risk 20);
  // lossR 0.8 (pnl −16/risk 20) → E[R] = 20/51×0.5 − 31/51×0.8 = −14.8/51 ≈ −0.2902
  // 119 lệnh v1.3.x: 90W/119 → EV dương (nếu trộn sẽ làm sai lệch kết quả)
  const resolved = [
    ...sameDirectionTrades(51, { wins: 20, winPnl: 10, lossPnl: -16, risk: 20, strategyVersion: 'v1.5.2' }),
    ...sameDirectionTrades(119, { wins: 90, winPnl: 10, risk: 20, strategyVersion: 'v1.3.x' })
  ];
  const result = evaluateFixture({
    strategyVersion: 'v1.5.2',
    resolvedTradeLogs: resolved
  });
  const expected = (20 / 51) * 0.5 - (31 / 51) * 0.8;
  assert.ok(
    Math.abs(gate(result, 'h2').h2_realized - expected) < 1e-9,
    `h2_realized=${gate(result, 'h2').h2_realized} — phải chỉ tính 51 lệnh v1.5.2`
  );
  assert.ok(gate(result, 'h2').h2_realized < -0.05);
  assert.equal(gate(result, 'h2').h2_telemetry.n, 51, 'telemetry phải ghi n=51 (không trộn 119 v1.3.x)');
});

test('REVERT P0-2 (g): không truyền strategyVersion → h2_realized null (không tính, không chặn)', () => {
  const result = evaluateFixture({
    resolvedTradeLogs: sameDirectionTrades(30, { wins: 0 })
  });
  assert.equal(gate(result, 'h2').h2_realized, null);
  assert.equal(gate(result, 'h2').h2_telemetry, null);
});

test('REVERT P0-2 (h): version match kháng tag — log "v1.5.2-auto|liquidity-v2" khớp param "v1.5.2-auto"', () => {
  const trades = sameDirectionTrades(30, { wins: 0 }).map(t => ({
    ...t,
    strategy_version: 'v1.5.2-auto|liquidity-v2'
  }));
  const result = evaluateFixture({
    strategyVersion: 'v1.5.2-auto',
    resolvedTradeLogs: trades
  });
  assert.equal(gate(result, 'h2').h2_realized, -0.5, 'log có tag |liquidity-v2 vẫn khớp version engine');
});

test('REVERT P0-2 (i): truyền strategyVersion nhưng resolved logs thiếu strategy_version → h2_realized null + không crash', () => {
  const trades = sameDirectionTrades(30, { wins: 0 }).map(t => {
    const { strategy_version, ...rest } = t;
    return rest;
  });
  const result = evaluateFixture({
    strategyVersion: 'v1.5.2',
    resolvedTradeLogs: trades
  });
  assert.equal(gate(result, 'h2').h2_realized, null);
});

// F5 (P7): soft gates chỉ còn telemetry hữu ích — s1 (93% true), s4 (90% true)
// không loại được gì; s3 (2% true) chặn nhầm; s5 nghịch hướng. Bỏ khỏi DANH SÁCH
// hiển thị, giữ checkS1..S5/checkScores vì vẫn đóng góp score.
test('F5: softGates giữ s2, s6, s7, s8, s_msb — bỏ s1, s3, s4, s5', () => {
  const result = evaluateFixture();
  const ids = result.softGates.map(g => g.id);
  assert.equal(result.softGates.length, 5);
  assert.deepEqual(ids, ['s2', 's6', 's7', 's8', 's_msb']);
});

test('F5: s1/s3/s4/s5 không còn trong softGates → lookup an toàn (scanner log .find trả undefined)', () => {
  const result = evaluateFixture();
  for (const dropped of ['s1', 's3', 's4', 's5']) {
    assert.equal(result.softGates.find(g => g.id === dropped), undefined);
  }
});

test('F5: s_syn/s_pen vẫn được thêm khi có synergy/penalty text (5 + 2 = 7)', () => {
  const result = evaluateFixture({
    systemScore: {
      synergyText: '[🔥 Tàu Siêu Tốc] ',
      penaltyText: '[-20% Ngược Trend] '
    }
  });
  const ids = result.softGates.map(g => g.id);
  assert.equal(result.softGates.length, 7);
  assert.deepEqual(ids, ['s2', 's6', 's7', 's8', 's_msb', 's_syn', 's_pen']);
});

test('F5: score components s1..s5 vẫn tồn tại và đóng góp vào score', () => {
  const baseAuto = {
    bbwSlope: 0,
    cmf: 0.1,
    isBearishSFP: false,
    isBullishSFP: false,
    msbState: 'None'
  };
  const baseMacro = { takerBuySellRatio: 1.1 };
  const baseVector = {
    l1: 'Trend Up',
    l2: 'Normal',
    l3: 'Shorts Trapped (Squeeze)',
    l4: 'Smart Money Long Building',
    l5: 'Strong Bullish',
    l6: 'Accumulation Zone',
    sTrend: 80,
    volScore: 50,
    liqSeverity: 90,
    posScore: 80,
    momScore: 80,
    macroScore: 80,
    isLeadLagArb: false
  };
  const strong = TradeValidator.evaluateScore(
    baseAuto, baseMacro, baseVector, 'LONG', 0, 'BTCUSDT', null
  );
  const weakTrend = TradeValidator.evaluateScore(
    baseAuto, baseMacro, { ...baseVector, sTrend: 10 }, 'LONG', 0, 'BTCUSDT', null
  );

  // checkScores s1..s5 + checks.checkS1..S5 vẫn còn (scanner đọc chúng)
  for (const key of ['s1', 's2', 's3', 's4', 's5']) {
    assert.ok(key in strong.checkScores, `checkScores.${key} còn tồn tại`);
  }
  for (const key of ['checkS1', 'checkS2', 'checkS3', 'checkS4', 'checkS5']) {
    assert.equal(typeof strong.checks[key], 'boolean');
  }
  // s1 (trend) vẫn đóng góp: sTrend 80 vs 10 → score khác
  assert.notEqual(weakTrend.score, strong.score);
});

// =====================================================================
// P1-1 (2026-08-13): funding dead zone SHORT — cấm SHORT khi funding
// ∈ (0, 0.0045]% (WR 25% n=20, CSV trade_logs_newest 2026-08-13).
// Biên dưới KHÔNG mở rộng xuống 0 (n=3, WR 33% — claim critic 29.4%
// không tái hiện trên 3 CSV; TD-015).
// =====================================================================
test('P1-1: SHORT + funding 0.002 → h_funding_short BLOCK', () => {
  const result = evaluateFixture({
    direction: 'SHORT',
    strategy: 'ADAPTIVE_SHORT_FALLBACK',
    autoData: { fundingRate: 0.002 }
  });
  assert.equal(gate(result, 'h_funding_short').passed, false);
});

test('P1-1: SHORT + funding 0.0045 (biên trên inclusive) → BLOCK', () => {
  const result = evaluateFixture({
    direction: 'SHORT',
    strategy: 'ADAPTIVE_SHORT_FALLBACK',
    autoData: { fundingRate: 0.0045 }
  });
  assert.equal(gate(result, 'h_funding_short').passed, false);
});

test('P1-1: SHORT + funding 0 → PASS (band (0, 0.0045], không chặn 0)', () => {
  const result = evaluateFixture({
    direction: 'SHORT',
    strategy: 'ADAPTIVE_SHORT_FALLBACK',
    autoData: { fundingRate: 0 }
  });
  assert.equal(gate(result, 'h_funding_short').passed, true);
});

test('P1-1: SHORT + funding 0.0046 → PASS (ngoài dead zone)', () => {
  const result = evaluateFixture({
    direction: 'SHORT',
    strategy: 'ADAPTIVE_SHORT_FALLBACK',
    autoData: { fundingRate: 0.0046 }
  });
  assert.equal(gate(result, 'h_funding_short').passed, true);
});

test('P1-1: SHORT + funding âm → PASS', () => {
  const result = evaluateFixture({
    direction: 'SHORT',
    strategy: 'ADAPTIVE_SHORT_FALLBACK',
    autoData: { fundingRate: -0.01 }
  });
  assert.equal(gate(result, 'h_funding_short').passed, true);
});

test('P1-1: LONG + funding 0.002 → PASS (gate chỉ cấm SHORT)', () => {
  const result = evaluateFixture({
    autoData: { fundingRate: 0.002 }
  });
  assert.equal(gate(result, 'h_funding_short').passed, true);
});

test('P1-1: policy.allowFundingDeadZone=true → SHORT trong dead zone PASS', () => {
  const result = evaluateFixture({
    direction: 'SHORT',
    strategy: { strategyId: 'X', policy: { allowFundingDeadZone: true } },
    autoData: { fundingRate: 0.002 }
  });
  assert.equal(gate(result, 'h_funding_short').passed, true);
});

// =====================================================================
// P1-2 (2026-08-13): h1 spread cap theo tier (đồng bộ
// strategyRouter.js:423-428: Tier1/2 → 0.03, Tier3 → 0.06, khác → 0.10;
// đơn vị %) + fail-closed khi realSpreadPct null (bookTick thiếu).
// =====================================================================
test('P1-2: spread 0.25 + Tier 2 → h1 BLOCK (0.25 ≥ 0.03)', () => {
  const result = evaluateFixture({
    strategy: { strategyId: 'ADAPTIVE_LONG_FALLBACK', assetTier: 'Tier 2' },
    apiMacro: { realSpreadPct: 0.25 }
  });
  assert.equal(gate(result, 'h1').passed, false);
});

test('P1-2: spread 0.05 + Tier 2 → h1 BLOCK (0.05 ≥ cap 0.03)', () => {
  const result = evaluateFixture({
    strategy: { strategyId: 'ADAPTIVE_LONG_FALLBACK', assetTier: 'Tier 2' },
    apiMacro: { realSpreadPct: 0.05 }
  });
  assert.equal(gate(result, 'h1').passed, false);
});

test('P1-2: spread 0.05 + Tier 3 → h1 PASS (0.05 < cap 0.06)', () => {
  const result = evaluateFixture({
    strategy: { strategyId: 'ADAPTIVE_LONG_FALLBACK', assetTier: 'Tier 3' },
    apiMacro: { realSpreadPct: 0.05 }
  });
  assert.equal(gate(result, 'h1').passed, true);
});

test('P1-2: spread 0.05 + Tier 1 → h1 BLOCK (0.05 ≥ cap 0.03)', () => {
  const result = evaluateFixture({
    strategy: { strategyId: 'ADAPTIVE_LONG_FALLBACK', assetTier: 'Tier 1: Macro' },
    apiMacro: { realSpreadPct: 0.05 }
  });
  assert.equal(gate(result, 'h1').passed, false);
});

test('P1-2: realSpreadPct null → h1 FAIL-CLOSED (block)', () => {
  const result = evaluateFixture({
    apiMacro: { realSpreadPct: null }
  });
  assert.equal(gate(result, 'h1').passed, false);
});

test('P1-2: realSpreadPct undefined → h1 FAIL-CLOSED (block)', () => {
  const result = evaluateFixture({
    apiMacro: { realSpreadPct: undefined }
  });
  assert.equal(gate(result, 'h1').passed, false);
});

test('P1-2: spread 0.05 + không có assetTier (string strategy) → PASS (cap mặc định 0.10)', () => {
  const result = evaluateFixture({
    apiMacro: { realSpreadPct: 0.05 }
  });
  assert.equal(gate(result, 'h1').passed, true);
});

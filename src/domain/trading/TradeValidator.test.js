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
    strategy
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

// F4 (P6): diagnostic h2_realized — E[R] thực tế cùng hướng, chỉ telemetry,
// KHÔNG đổi isApproved. avgWinR = 0.50, avgLossR = 0.62 (từ dữ liệu).
function sameDirectionTrades(count, { wins, direction = 'LONG' } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    symbol: 'BTCUSDT',
    direction,
    status: i < wins ? 'WIN' : 'LOSS',
    pnl_usd: i < wins ? 10 : -10,
    risk_amount_usd: 20,
    close_time: new Date(Date.now() - 60 * 60 * 1000).toISOString()
  }));
}

test('F4: ≥5 lệnh cùng direction → h2_realized tính đúng E[R]', () => {
  const result = evaluateFixture({
    tradeLogs: sameDirectionTrades(10, { wins: 6 })
  });
  // WR = 0.6 → E_R = 0.6*0.50 − 0.4*0.62 = 0.3 − 0.248 = 0.052
  assert.ok(
    Math.abs(gate(result, 'h2').h2_realized - 0.052) < 1e-9,
    `h2_realized=${gate(result, 'h2').h2_realized}`
  );
});

test('F4: 5 lệnh thua cùng direction → h2_realized = −0.62', () => {
  const result = evaluateFixture({
    tradeLogs: sameDirectionTrades(5, { wins: 0 })
  });
  assert.equal(gate(result, 'h2').h2_realized, -0.62);
});

test('F4: <5 lệnh cùng direction → h2_realized null', () => {
  const result = evaluateFixture({
    tradeLogs: sameDirectionTrades(4, { wins: 2 })
  });
  assert.equal(gate(result, 'h2').h2_realized, null);
});

test('F4: h2_realized chỉ đếm lệnh cùng direction (khác hướng không tính)', () => {
  const trades = [
    ...sameDirectionTrades(5, { wins: 0, direction: 'LONG' }),
    ...sameDirectionTrades(5, { wins: 5, direction: 'SHORT' })
  ];
  const result = evaluateFixture({
    direction: 'LONG',
    tradeLogs: trades
  });
  // CHỈ LONG được tính: 0 WIN / 5 LOSS → E_R = −0.62
  assert.equal(gate(result, 'h2').h2_realized, -0.62);
});

test('F4: h2_realized là informational — isApproved và h2.passed không đổi', () => {
  const withoutLogs = evaluateFixture();
  // Dùng toàn WIN (không LOSS gần) để không kích hoạt gate cooldown h_cd —
  // mục đích: chỉ h2_realized thay đổi, isApproved/h2.passed phải nguyên vẹn.
  const withLogs = evaluateFixture({
    tradeLogs: sameDirectionTrades(6, { wins: 6 })
  });
  assert.equal(withLogs.isApproved, withoutLogs.isApproved);
  assert.equal(gate(withLogs, 'h2').passed, gate(withoutLogs, 'h2').passed);
  assert.equal(gate(withLogs, 'h2').h2_realized, 0.5);
});

// B3 (TP1 ~1R): requiredRR hạ từ 1.8 → 0.7 (bbwRank ≤ 80). Một setup RR 0.75
// với EV −0.06 (< −0.05, cửa EV đóng) phải PASS h2 nhờ cửa RR mới.
// Lưu ý: spec đề xuất EV −0.02, nhưng −0.02 > −0.05 đã pass từ trước (không
// RED được); dùng −0.06 để chứng minh đúng cửa RR là thứ cứu gate.
test('B3: theoreticalRR 0.75 + EV −0.06 → h2 PASS nhờ requiredRR 0.7', () => {
  const result = evaluateFixture({
    mathCore: { theoreticalRR: 0.75, trueEVValue: -0.06 }
  });
  assert.equal(gate(result, 'h2').passed, true);
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

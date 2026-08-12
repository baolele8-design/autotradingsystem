import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveMathCore } from './riskSizing.js';

// Regression F1 (P1): riskMultiplier đã bị xóa — appliedRiskPercent phải bằng
// tradeSetup.riskPercent, không còn bị phóng đại theo score (cũ: ×2.0 @score 100,
// ×0.5 @score == passingScore). Dữ liệu bác bỏ multiplier (Spearman −0.036, p=0.599).
function buildFixture(overrides = {}) {
  const base = {
    autoData: {
      atrPercent: 1.0,
      bbwRank: 50,
      fundingRate: 0.01,
      obi: 0.5
    },
    apiMacro: {
      sessionMultiplier: 1,
      realSpreadPct: 0.01
    },
    liveCapital: 10000,
    availableBalance: 10000,
    tradeSetup: {
      entry: 100,
      slTech: 98,
      tp1: 106,
      riskPercent: 1.0,
      tradeType: 'FUTURES',
      direction: 'LONG',
      execution: 'LIMIT',
      holdingCycles: 6,
      activeStrategyId: 'UNKNOWN_TEST_STRATEGY'
    },
    symbol: 'BTCUSDT',
    tradeStats: {
      totalClosed: 50,
      winRate: 0.5,
      historicalRR: 1.5
    },
    leverageBrackets: [
      {
        bracket: 1,
        initialLeverage: 125,
        notionalCap: 50000,
        notionalFloor: 0,
        maintMarginRatio: 0.004
      }
    ],
    vectorRegime: {
      details: { l1: 'Trend', l2: 'Normal' }
    },
    tradeFees: { maker: 0.0002, taker: 0.0004 },
    dynamicMinNotionals: { BTCUSDT: 5 },
    systemScore: { score: 100, passingScore: 50 },
    intervalTime: '1h',
    activeTierClass: 'Tier 2'
  };
  return { ...base, ...overrides, tradeSetup: { ...base.tradeSetup, ...(overrides.tradeSetup || {}) }, systemScore: { ...base.systemScore, ...(overrides.systemScore || {}) } };
}

test('score=100: appliedRiskPercent == riskPercent (không còn ×2)', () => {
  const result = deriveMathCore(buildFixture());
  // Cũ: 1.0 × (0.5 + ((100-50)/50)*1.5) = 2.00 — test này là regression chống tái sinh multiplier.
  assert.equal(parseFloat(result.appliedRiskPercent), 1.0);
  assert.equal(result.appliedRiskPercent, '1.00');
});

test('score == passingScore: appliedRiskPercent == riskPercent (không còn ×0.5)', () => {
  const result = deriveMathCore(
    buildFixture({ systemScore: { score: 50, passingScore: 50 } })
  );
  // Cũ: 1.0 × (0.5 + 0) = 0.50
  assert.equal(parseFloat(result.appliedRiskPercent), 1.0);
});

test('riskPercent thấp vẫn được tôn trọng (không bị ép về hằng số)', () => {
  const result = deriveMathCore(
    buildFixture({ tradeSetup: { riskPercent: 0.5 } })
  );
  assert.equal(parseFloat(result.appliedRiskPercent), 0.5);
  assert.equal(result.appliedRiskPercent, '0.50');
});

test('appliedRiskPercent không phụ thuộc score nữa (score 40 vs 90 cùng riskPercent)', () => {
  const low = deriveMathCore(
    buildFixture({ systemScore: { score: 40, passingScore: 50 } })
  );
  const high = deriveMathCore(
    buildFixture({ systemScore: { score: 90, passingScore: 50 } })
  );
  assert.equal(low.appliedRiskPercent, high.appliedRiskPercent);
  assert.equal(parseFloat(high.appliedRiskPercent), 1.0);
});

// O4 (team-D 2026-08-12): Bayesian prior theo BTC regime — với totalClosed < 30
// prior có trọng số, EV phải thấp hơn khi Downtrend 4h (0.42) và cao hơn khi
// Uptrend (0.48) so với mặc định 0.45.
function evWithRegime(btcRegime) {
  const result = deriveMathCore(
    buildFixture({
      tradeStats: { totalClosed: 10, winRate: 0.5, historicalRR: 1.5 },
      btcRegime
    })
  );
  return parseFloat(result.trueEVValue);
}

test('O4: btcRegime Downtrend hạ Bayesian prior → EV thấp hơn mặc định', () => {
  const evDefault = evWithRegime(undefined);
  const evDowntrend = evWithRegime('Downtrend');
  assert.ok(evDowntrend < evDefault, `expected ${evDowntrend} < ${evDefault}`);
});

test('O4: btcRegime Uptrend nâng Bayesian prior → EV cao hơn mặc định', () => {
  const evDefault = evWithRegime(undefined);
  const evUptrend = evWithRegime('Uptrend');
  assert.ok(evUptrend > evDefault, `expected ${evUptrend} > ${evDefault}`);
});

test('O4: btcRegime khác (Range/thiếu) giữ prior mặc định 0.45', () => {
  assert.equal(evWithRegime(undefined), evWithRegime('Range'));
  assert.equal(evWithRegime(undefined), evWithRegime('Unknown'));
});

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
    checkScores: {}
  };
  return { apiMacro, autoData, mathCore, systemScore, vectorDetails };
}

function evaluateFixture({
  direction = 'LONG',
  strategy = 'ADAPTIVE_LONG_FALLBACK',
  tradeType = 'FUTURES',
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
    [],
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

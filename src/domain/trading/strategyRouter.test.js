import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADAPTIVE_FALLBACK_CATALOG,
  PAPER_STRATEGY_CATALOG,
  ROLLOUT_MODE,
  STRATEGY_IDS,
  allowsHighVpin,
  allowsRange,
  evaluateStrategyCandidates,
  getStrategyDefinition,
  routeAdaptiveStrategy,
  routeStrategy,
  selectStrategyLaneWinners
} from './strategyRouter.js';

const createInput = (overrides = {}) => {
  const autoData = {
    currentPrice: 100,
    atr14: 2,
    atrRank: 50,
    bbwRank: 50,
    bbwSlope: 0,
    lastClosedVolume: 120,
    avgVolume20: 100,
    rsi: 50,
    adx: 30,
    hurstValue: 0.58,
    cmf: 0.08,
    cvdTrend: 4,
    obi: 0.60,
    oiDelta: 0.5,
    oiDeltaRank: 50,
    fundingRate: 0,
    fundingSlope: 0,
    fundingRateRank: 50,
    fundingSlopeRank: 50,
    amihudRank: 50,
    amihudReady: true,
    liqLongRatio: 0,
    liqShortRatio: 0,
    liquidationCoverageReady: true,
    liquidationReady: true,
    liquidationStale: false,
    ema20: { value: 100.5, slope: 0.20 },
    ema50: { value: 99, slope: 0.10 },
    htfSma200: 95,
    vwap: 100,
    vwapUpper: 104,
    vwapLower: 96,
    macd: { hist: 0.2 },
    msbState: 'None',
    isBullishSFP: false,
    isBearishSFP: false,
    btcDomSlope: 0
  };
  const apiMacro = {
    realSpreadPct: 0.02,
    takerBuySellRatio: 1.10,
    lsPositionVolRatio: 1.10,
    longShortRatio: 1
  };
  const vectorDetails = {
    l1: 'Trend Up',
    l2: 'Normal',
    sTrend: 45,
    momScore: 30,
    posScore: 30,
    isAltcoinSeason: false,
    isAltcoinBleeding: false,
    isLeadLagArb: false
  };

  return {
    symbol: 'BTCUSDT',
    assetTier: 'Tier 1: Macro',
    direction: 'LONG',
    autoData: {
      ...autoData,
      ...overrides.autoData,
      ema20: {
        ...autoData.ema20,
        ...overrides.autoData?.ema20
      },
      ema50: {
        ...autoData.ema50,
        ...overrides.autoData?.ema50
      },
      macd: {
        ...autoData.macd,
        ...overrides.autoData?.macd
      }
    },
    apiMacro: {
      ...apiMacro,
      ...overrides.apiMacro
    },
    vectorDetails: {
      ...vectorDetails,
      ...overrides.vectorDetails
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([key]) => !['autoData', 'apiMacro', 'vectorDetails'].includes(key)
      )
    )
  };
};

const paperFixtureById = {
  CAPITULATION_RECLAIM: createInput({
    autoData: {
      atrRank: 90,
      oiDelta: -3,
      oiDeltaRank: 5,
      liqLongRatio: 0.12,
      isBullishSFP: true,
      rsi: 30,
      obi: 0.66,
      cmf: 0.10
    }
  }),
  PASSIVE_ABSORPTION_REVERSAL: createInput({
    autoData: {
      currentPrice: 95,
      isBullishSFP: true,
      cvdTrend: -8,
      cmf: 0.10,
      obi: 0.70,
      lastClosedVolume: 140
    }
  }),
  CROWDED_CARRY_UNWIND: createInput({
    autoData: {
      fundingRate: -0.02,
      fundingSlope: -0.03,
      fundingRateRank: 5,
      fundingSlopeRank: 5,
      oiDeltaRank: 60,
      msbState: 'Bullish_MSB'
    },
    apiMacro: {
      longShortRatio: 0.80,
      lsPositionVolRatio: 1.10
    }
  }),
  VOL_COMPRESSION_IGNITION: createInput({
    autoData: {
      bbwRank: 20,
      bbwSlope: 8,
      lastClosedVolume: 170,
      msbState: 'Bullish_MSB',
      cvdTrend: 4,
      oiDelta: 0.5,
      hurstValue: 0.60
    },
    vectorDetails: { l2: 'Compression' }
  }),
  LIQUIDITY_VACUUM_DRIVE: createInput({
    autoData: {
      currentPrice: 101,
      ema20: { value: 100, slope: 0.2 },
      amihudRank: 90,
      bbwRank: 75,
      bbwSlope: 8,
      lastClosedVolume: 200,
      msbState: 'Bullish_MSB',
      cvdTrend: 6
    },
    vectorDetails: { l2: 'Expansion' }
  }),
  CVD_STRUCTURE_DIVERGENCE: createInput({
    autoData: {
      currentPrice: 95,
      ema20: { value: 96, slope: 0.1 },
      htfSma200: 100,
      rsi: 35,
      cvdTrend: 12,
      cmf: 0.02,
      obi: 0.60,
      oiDelta: -0.2,
      msbState: 'Bullish_MSB'
    },
    vectorDetails: { l1: 'Trend Down', sTrend: -35 }
  }),
  SMART_MONEY_OI_BUILD: createInput({
    autoData: {
      oiDelta: 1.5,
      oiDeltaRank: 80,
      adx: 30,
      cvdTrend: 4,
      cmf: 0.10
    }
  }),
  VALUE_AREA_TREND_PULLBACK: createInput({
    autoData: {
      currentPrice: 100,
      ema20: { value: 101, slope: 0.20 },
      ema50: { value: 99, slope: 0.10 },
      hurstValue: 0.60,
      adx: 30,
      rsi: 50,
      cvdTrend: 0,
      oiDeltaRank: 50
    },
    vectorDetails: { sTrend: 45 }
  }),
  FLOW_REACCELERATION: createInput({
    autoData: {
      currentPrice: 101.6,
      ema20: { value: 100, slope: 0.25 },
      ema50: { value: 99, slope: 0.10 },
      adx: 40,
      hurstValue: 0.65,
      cvdTrend: 6,
      cmf: 0.10,
      oiDelta: 0.5,
      oiDeltaRank: 60,
      bbwRank: 50,
      macd: { hist: 0.3 }
    },
    vectorDetails: { sTrend: 70 }
  }),
  ALT_CAPITAL_ROTATION: createInput({
    symbol: 'ETHUSDT',
    autoData: {
      currentPrice: 101.6,
      ema20: { value: 100, slope: 0.20 },
      ema50: { value: 99, slope: 0.10 },
      btcDomSlope: -0.7,
      cvdTrend: 3,
      oiDelta: 0.5
    },
    vectorDetails: {
      sTrend: 45,
      isAltcoinSeason: true
    }
  }),
  VOLATILITY_EXTREME_FADE: createInput({
    autoData: {
      currentPrice: 90,
      htfSma200: 90,
      atrRank: 95,
      bbwRank: 95,
      hurstValue: 0.40,
      rsi: 20,
      cmf: 0.10,
      obi: 0.70,
      oiDelta: -0.5,
      cvdTrend: -2
    },
    vectorDetails: {
      l1: 'Chop / Mean Reversion',
      l2: 'Extreme',
      sTrend: 0
    }
  })
};

test('publishes eleven stable live strategies and two live fallbacks', () => {
  assert.equal(PAPER_STRATEGY_CATALOG.length, 11);
  assert.equal(ADAPTIVE_FALLBACK_CATALOG.length, 2);
  assert.equal(Object.keys(STRATEGY_IDS).length, 13);

  const ids = PAPER_STRATEGY_CATALOG.map(item => item.strategyId);
  const priorities = PAPER_STRATEGY_CATALOG.map(item => item.priority);

  assert.equal(new Set(ids).size, 11);
  assert.equal(new Set(priorities).size, 11);
  assert.deepEqual(
    [...priorities].sort((a, b) => b - a),
    priorities,
    'catalog order must be deterministic priority order'
  );

  PAPER_STRATEGY_CATALOG.forEach(strategy => {
    assert.equal(strategy.rolloutMode, ROLLOUT_MODE.LIVE);
    assert.equal(strategy.profile.slMult > 0, true);
    assert.equal(strategy.profile.tpMult > strategy.profile.slMult, true);
    assert.equal(strategy.profile.holdingCycles > 0, true);
    assert.equal(strategy.profile.minScore >= 50, true);
    assert.equal(Object.isFrozen(strategy), true);
    assert.equal(Object.isFrozen(strategy.profile), true);
  });

  ADAPTIVE_FALLBACK_CATALOG.forEach(strategy => {
    assert.equal(strategy.rolloutMode, ROLLOUT_MODE.LIVE);
    assert.equal(strategy.family, 'ADAPTIVE');
  });
});

test('each paper strategy has a codeable fixture satisfying regime, trigger and 2-of-N confirmations', () => {
  Object.entries(paperFixtureById).forEach(([strategyId, input]) => {
    const candidate = evaluateStrategyCandidates(input).find(
      item => item.strategyId === strategyId
    );

    assert.equal(candidate?.diagnostics.regimePassed, true, `${strategyId} regime`);
    assert.equal(candidate?.diagnostics.triggerPassed, true, `${strategyId} trigger`);
    assert.equal(
      candidate?.diagnostics.confirmationPassed >= 2,
      true,
      `${strategyId} confirmations`
    );
    assert.equal(candidate?.diagnostics.matched, true, `${strategyId} match`);
    assert.equal(
      routeStrategy(input).strategyId,
      strategyId,
      `${strategyId} should win its isolated routing fixture`
    );
  });
});

test('routes explicit LONG and SHORT directions without changing the strategy identity', () => {
  const longResult = routeStrategy(paperFixtureById.CAPITULATION_RECLAIM);
  const shortResult = routeStrategy(createInput({
    direction: 'SHORT',
    autoData: {
      atrRank: 90,
      oiDelta: -3,
      oiDeltaRank: 5,
      liqShortRatio: 0.12,
      isBearishSFP: true,
      rsi: 70,
      obi: 0.34,
      cmf: -0.10,
      cvdTrend: 1
    },
    apiMacro: {
      takerBuySellRatio: 0.90,
      lsPositionVolRatio: 0.90
    },
    vectorDetails: {
      l1: 'Trend Down',
      sTrend: -45,
      momScore: -30,
      posScore: -30
    }
  }));

  assert.equal(longResult.strategyId, 'CAPITULATION_RECLAIM');
  assert.equal(longResult.direction, 'LONG');
  assert.equal(shortResult.strategyId, 'CAPITULATION_RECLAIM');
  assert.equal(shortResult.direction, 'SHORT');
});

test('requires two confirmations after both regime and trigger pass', () => {
  const oneConfirmation = createInput({
    autoData: {
      bbwRank: 20,
      bbwSlope: 8,
      lastClosedVolume: 170,
      msbState: 'Bullish_MSB',
      cvdTrend: 3,
      obi: 0.50,
      oiDelta: -1,
      hurstValue: 0.40,
      fundingRateRank: 5
    },
    vectorDetails: { l2: 'Compression' }
  });
  const twoConfirmations = createInput({
    ...oneConfirmation,
    autoData: {
      ...oneConfirmation.autoData,
      obi: 0.60
    }
  });

  const findIgnition = input => evaluateStrategyCandidates(input).find(
    item => item.strategyId === 'VOL_COMPRESSION_IGNITION'
  );

  assert.equal(findIgnition(oneConfirmation).diagnostics.regimePassed, true);
  assert.equal(findIgnition(oneConfirmation).diagnostics.triggerPassed, true);
  assert.equal(findIgnition(oneConfirmation).diagnostics.confirmationPassed, 1);
  assert.equal(findIgnition(oneConfirmation).diagnostics.matched, false);
  assert.equal(findIgnition(twoConfirmations).diagnostics.confirmationPassed, 2);
  assert.equal(findIgnition(twoConfirmations).diagnostics.matched, true);
});

test('resolves overlapping matches by catalog priority', () => {
  const overlapping = createInput({
    autoData: {
      bbwRank: 20,
      bbwSlope: 8,
      lastClosedVolume: 180,
      msbState: 'Bullish_MSB',
      cvdTrend: 5,
      obi: 0.62,
      oiDelta: 1.5,
      oiDeltaRank: 80,
      hurstValue: 0.60,
      adx: 32
    },
    vectorDetails: { l2: 'Compression' }
  });
  const matchedIds = evaluateStrategyCandidates(overlapping)
    .filter(candidate => candidate.diagnostics.matched)
    .map(candidate => candidate.strategyId);

  assert.equal(matchedIds.includes('VOL_COMPRESSION_IGNITION'), true);
  assert.equal(matchedIds.includes('SMART_MONEY_OI_BUILD'), true);
  assert.equal(routeStrategy(overlapping).strategyId, 'VOL_COMPRESSION_IGNITION');
});

test('falls back to a live Adaptive definition when no paper rule matches', () => {
  const input = createInput({
    autoData: {},
    apiMacro: {},
    vectorDetails: {}
  });
  input.autoData = {};
  input.apiMacro = {};
  input.vectorDetails = {};

  const result = routeStrategy(input);

  assert.equal(result.strategyId, 'ADAPTIVE_LONG_FALLBACK');
  assert.equal(result.rolloutMode, ROLLOUT_MODE.LIVE);
  assert.equal(result.isFallback, true);
});

test('can emit the live Adaptive lane beside a matched live strategy', () => {
  const input = paperFixtureById.CAPITULATION_RECLAIM;

  const paperResult = routeStrategy(input);
  const liveResult = routeAdaptiveStrategy(input);

  assert.equal(paperResult.strategyId, 'CAPITULATION_RECLAIM');
  assert.equal(paperResult.rolloutMode, ROLLOUT_MODE.LIVE);
  assert.equal(liveResult.strategyId, 'ADAPTIVE_LONG_FALLBACK');
  assert.equal(liveResult.rolloutMode, ROLLOUT_MODE.LIVE);
});

test('keeps one independently ranked winner in paper and live lanes', () => {
  const winners = selectStrategyLaneWinners([
    {
      rolloutMode: ROLLOUT_MODE.PAPER_ONLY,
      score: 80,
      strategyId: 'PAPER_LOW'
    },
    {
      rolloutMode: ROLLOUT_MODE.LIVE,
      score: 70,
      strategyId: 'LIVE_WINNER'
    },
    {
      rolloutMode: ROLLOUT_MODE.PAPER_ONLY,
      score: 90,
      strategyId: 'PAPER_WINNER'
    }
  ]);

  assert.deepEqual(
    winners.map(item => item.strategyId),
    ['PAPER_WINNER', 'LIVE_WINNER']
  );
});

test('exposes strategy-aware range and high-VPIN policies by stable ID', () => {
  assert.equal(allowsRange('VOLATILITY_EXTREME_FADE'), true);
  assert.equal(allowsRange('FLOW_REACCELERATION'), false);
  assert.equal(allowsHighVpin('CAPITULATION_RECLAIM'), true);
  assert.equal(allowsHighVpin('VALUE_AREA_TREND_PULLBACK'), false);
  assert.equal(getStrategyDefinition('NOT_A_STRATEGY'), null);
});

test('is deterministic, does not mutate inputs, and rejects ambiguous directions', () => {
  const input = paperFixtureById.FLOW_REACCELERATION;
  const snapshot = structuredClone(input);

  const first = routeStrategy(input);
  const second = routeStrategy(input);

  assert.deepEqual(first, second);
  assert.deepEqual(input, snapshot);
  assert.throws(
    () => routeStrategy({ ...input, direction: 'BUY' }),
    /LONG or SHORT/
  );
});

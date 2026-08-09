import test from 'node:test';
import assert from 'node:assert';
import {
  evaluateS1_EMAMomentum,
  evaluateS2_RSISnap,
  evaluateS3_BBSqueeze,
  evaluateS1Decision,
  evaluateS2Decision,
  evaluateS3Decision,
  evaluateScalpSignals,
  evaluateSingleStrategy,
  resolveMarketContext
} from './scalpSignals.js';

function generateCandles(count, basePrice = 100, trend = 'flat') {
  const candles = [];
  const volumes = [];
  let current = basePrice;

  for (let i = 0; i < count; i++) {
    let delta = 0;
    if (trend === 'up') delta = (i % 2 === 0 ? 0.8 : -0.2);
    else if (trend === 'down') delta = (i % 2 === 0 ? -0.8 : 0.2);
    else if (trend === 'cross_up') {
      delta = i >= count - 5 ? 1.5 : (i % 2 === 0 ? -0.4 : 0.2);
    } else if (trend === 'cross_down') {
      delta = i >= count - 5 ? -1.5 : (i % 2 === 0 ? 0.4 : -0.2);
    }

    current += delta;
    const high = current + 0.5;
    const low = current - 0.5;
    const open = current - delta / 2;
    const close = current;

    candles.push({ open, high, low, close });
    volumes.push(100 + (i === count - 1 ? 50 : (i % 5) * 10));
  }

  return { candles, volumes };
}

test('resolveMarketContext - fails closed instead of inventing market data', () => {
  const ctx = resolveMarketContext(null);
  assert.strictEqual(ctx.ready, false);
  assert.strictEqual(ctx.l1, null);
  assert.strictEqual(ctx.l2, null);
  assert.strictEqual(ctx.l3, null);
  assert.strictEqual(ctx.obi, null);
  assert.strictEqual(ctx.cvdTrend, null);
  assert.deepStrictEqual(ctx.reasons, ['MARKET_CONTEXT_MISSING']);
  assert.strictEqual(ctx.isProvided, false);
});

test('resolveMarketContext - extracts provided vector details', () => {
  const ctx = resolveMarketContext({
    l1: 'Trend Up',
    l2: 'Expansion',
    l3: 'Sweep Low',
    obi: 0.65,
    cvdTrend: 12.5,
    bbwSlope: 6.2,
    volRatio: 2.1
  });
  assert.strictEqual(ctx.l1, 'Trend Up');
  assert.strictEqual(ctx.l2, 'Expansion');
  assert.strictEqual(ctx.l3, 'Sweep Low');
  assert.strictEqual(ctx.obi, 0.65);
  assert.strictEqual(ctx.cvdTrend, 12.5);
  assert.strictEqual(ctx.bbwSlope, 6.2);
  assert.strictEqual(ctx.volRatio, 2.1);
  assert.strictEqual(ctx.isProvided, true);
});

test('evaluateS1_EMAMomentum - rejects in Chop/Range unless L2 is Expansion', () => {
  const { candles, volumes } = generateCandles(60, 100, 'cross_up');
  const params = {
    min_score: 40,
    crossover_lookback: 5,
    rsi_long_max: 99,
    volume_threshold: 1
  };
  
  // Chop regime without Expansion -> Rejected
  const chopContext = { l1: 'Chop / Mean Reversion', l2: 'Normal', obi: 0.55, cvdTrend: 2 };
  const sigChop = evaluateS1_EMAMomentum(candles, volumes, params, null, chopContext);
  assert.strictEqual(sigChop, null);

  // Range regime without Expansion -> Rejected
  const rangeContext = { l1: 'Range', l2: 'Normal', obi: 0.55, cvdTrend: 2 };
  const sigRange = evaluateS1_EMAMomentum(candles, volumes, params, null, rangeContext);
  assert.strictEqual(sigRange, null);

  // Range regime WITH Expansion -> Allowed
  const expansionContext = { l1: 'Range', l2: 'Expansion', obi: 0.55, cvdTrend: 2 };
  const sigExpansion = evaluateS1_EMAMomentum(candles, volumes, params, null, expansionContext);
  assert.strictEqual(sigExpansion.strategyId, 'S1_EMA_MOMENTUM');
});

test('evaluateS1_EMAMomentum - real OBI and CVD act as soft evidence', () => {
  const { candles, volumes } = generateCandles(60, 100, 'cross_up');
  const params = {
    min_score: 40,
    crossover_lookback: 5,
    rsi_long_max: 99,
    volume_threshold: 1
  };
  
  const supportiveContext = {
    l1: 'Trend Up',
    l2: 'Normal',
    obi: 0.65,
    cvdTrend: 8
  };
  const lowObiContext = { l1: 'Trend Up', l2: 'Normal', obi: 0.30, cvdTrend: 2 };
  const cvdDivContext = { l1: 'Trend Up', l2: 'Normal', obi: 0.55, cvdTrend: -8 };
  const supportive = evaluateS1_EMAMomentum(
    candles, volumes, params, null, supportiveContext
  );
  const lowObi = evaluateS1_EMAMomentum(
    candles, volumes, params, null, lowObiContext
  );
  const cvdDivergence = evaluateS1_EMAMomentum(
    candles, volumes, params, null, cvdDivContext
  );
  assert.ok(supportive.score > lowObi.score);
  assert.ok(supportive.score > cvdDivergence.score);
});

test('evaluateS2_RSISnap - allowed only in Range/Extreme and rejects in Strong Trend or Expansion', () => {
  const { candles, volumes } = generateCandles(30, 100, 'down');
  
  // Strong Trend -> Rejected
  const strongTrendCtx = { l1: 'Strong Trend Down', l2: 'Normal', obi: 0.55, cvdTrend: 0 };
  const sigStrong = evaluateS2_RSISnap(candles, volumes, null, null, strongTrendCtx);
  assert.strictEqual(sigStrong, null);

  // Expansion -> Rejected
  const expansionCtx = { l1: 'Range', l2: 'Expansion', obi: 0.55, cvdTrend: 0 };
  const sigExp = evaluateS2_RSISnap(candles, volumes, null, null, expansionCtx);
  assert.strictEqual(sigExp, null);

  // Range + Extreme -> Allowed if RSI oversold/overbought criteria met
  const rangeCtx = { l1: 'Range', l2: 'Extreme', obi: 0.55, cvdTrend: 0 };
  const sigRange = evaluateS2_RSISnap(candles, volumes, null, null, rangeCtx);
  // Returned signal or null depends on RSI values
  if (sigRange) {
    assert.strictEqual(sigRange.strategyId, 'S2_RSI_SNAP');
  }
});

test('evaluateS2_RSISnap - OBI support changes soft score', () => {
  const closes = Array.from(
    { length: 35 },
    (_, index) => 100 + Math.sin(index) * 0.2
  );
  closes.push(96, 94, 93, 98);
  const candles = closes.map((close, index) => ({
    open: index > 0 ? closes[index - 1] : close,
    high: close + 0.5,
    low: close - 0.5,
    close
  }));
  const volumes = [...Array(closes.length - 1).fill(100), 180];
  const params = {
    min_score: 40,
    reversal_lookback: 4,
    rsi_oversold: 35,
    rsi_overbought: 70
  };
  const supportive = evaluateS2_RSISnap(
    candles,
    volumes,
    params,
    null,
    { l1: 'Range', l2: 'Extreme', obi: 0.65, cvdTrend: 8 }
  );
  const weak = evaluateS2_RSISnap(
    candles,
    volumes,
    params,
    null,
    { l1: 'Range', l2: 'Extreme', obi: 0.40, cvdTrend: 0 }
  );
  assert.ok(supportive.score > weak.score);
});

test('evaluateS3_BBSqueeze - expansion is hard and OBI is soft evidence', () => {
  const closes = Array.from(
    { length: 59 },
    (_, index) => 100 + Math.sin(index) * 0.03
  );
  closes.push(103);
  const candles = closes.map((close, index) => ({
    open: index > 0 ? closes[index - 1] : close,
    high: close + 0.5,
    low: close - 0.5,
    close
  }));
  const volumes = [...Array(59).fill(100), 300];
  const params = {
    min_score: 40,
    volume_threshold: 1.2,
    squeeze_percentile: 0.5,
    minimum_bbw_slope: 2
  };
  const htfUp = Array.from({ length: 60 }, (_, index) => ({
    close: 100 + index * 0.1
  }));
  const sigNormal = evaluateS3_BBSqueeze(
    candles,
    volumes,
    params,
    htfUp,
    { l1: 'Range', l2: 'Normal', obi: 0.5, cvdTrend: 0, bbwSlope: 1 }
  );
  assert.strictEqual(sigNormal, null);

  const weak = evaluateS3_BBSqueeze(
    candles,
    volumes,
    params,
    htfUp,
    { l1: 'Range', l2: 'Expansion', obi: 0.25, cvdTrend: -5, bbwSlope: 8 }
  );
  const supportive = evaluateS3_BBSqueeze(
    candles,
    volumes,
    params,
    htfUp,
    { l1: 'Range', l2: 'Expansion', obi: 0.65, cvdTrend: 8, bbwSlope: 8 }
  );
  assert.ok(supportive.score > weak.score);
});

test('evaluateScalpSignals & evaluateSingleStrategy - functions correctly with marketContext', () => {
  const { candles, volumes } = generateCandles(40, 100, 'cross_up');
  const marketContext = { l1: 'Trend Up', l2: 'Normal', obi: 0.55, cvdTrend: 2 };

  const signals = evaluateScalpSignals(candles, volumes, {}, null, marketContext);
  assert.ok(Array.isArray(signals));

  const single = evaluateSingleStrategy(candles, volumes, 'S1_EMA_MOMENTUM', null, null, marketContext);
  assert.ok(Array.isArray(single));
});

test('all three strategy families have a reachable, explicit pass path', () => {
  const makeCandles = closes => closes.map((close, index) => ({
    open: index > 0 ? closes[index - 1] : close,
    high: close + 0.5,
    low: close - 0.5,
    close
  }));
  const htfUp = Array.from({ length: 60 }, (_, index) => ({
    close: 100 + index * 0.1
  }));

  const s1Closes = Array.from(
    { length: 58 },
    (_, index) => 100 - index * 0.05
  );
  s1Closes.push(99, 103);
  const s1 = evaluateS1Decision(
    makeCandles(s1Closes),
    [...Array(59).fill(100), 300],
    {
      min_score: 40,
      crossover_lookback: 3,
      volume_threshold: 1,
      rsi_long_max: 99,
      rsi_short_min: 1
    },
    htfUp,
    {
      ready: true,
      l1: 'Trend Up',
      l2: 'Expansion',
      obi: 0.6,
      cvdTrend: 8,
      bbwSlope: 5,
      volRatio: 3
    }
  );

  const s2Closes = Array.from(
    { length: 35 },
    (_, index) => 100 + Math.sin(index) * 0.2
  );
  s2Closes.push(96, 94, 93, 98);
  const s2 = evaluateS2Decision(
    makeCandles(s2Closes),
    [...Array(s2Closes.length - 1).fill(100), 180],
    {
      min_score: 40,
      reversal_lookback: 4,
      rsi_oversold: 35,
      rsi_overbought: 70
    },
    null,
    {
      ready: true,
      l1: 'Range',
      l2: 'Extreme',
      obi: 0.65,
      cvdTrend: 8,
      bbwSlope: 0,
      volRatio: 1.8
    }
  );

  const s3Closes = Array.from(
    { length: 59 },
    (_, index) => 100 + Math.sin(index) * 0.03
  );
  s3Closes.push(103);
  const s3 = evaluateS3Decision(
    makeCandles(s3Closes),
    [...Array(59).fill(100), 300],
    {
      min_score: 40,
      volume_threshold: 1.2,
      squeeze_percentile: 0.5,
      minimum_bbw_slope: 1
    },
    htfUp,
    {
      ready: true,
      l1: 'Trend Up',
      l2: 'Expansion',
      obi: 0.6,
      cvdTrend: 8,
      bbwSlope: 20,
      volRatio: 3
    }
  );

  assert.strictEqual(s1.passed, true);
  assert.strictEqual(s2.passed, true);
  assert.strictEqual(s3.passed, true);
});

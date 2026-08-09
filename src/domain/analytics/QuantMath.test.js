import test from 'node:test';
import assert from 'node:assert/strict';

import QuantMath from './QuantMath.js';

test('keeps every public QuantMath function available after modularization', () => {
  const expectedFunctions = [
    'sma',
    'ema',
    'emaSeries',
    'macd',
    'vwapWithBands',
    'cvd',
    'hurst',
    'orderBookHeatmap',
    'evaluateL1',
    'evaluateL2',
    'evaluateL3',
    'evaluateL4',
    'evaluateL5',
    'evaluateL6',
    'evaluateVectorState',
    'trueRange',
    'atr',
    'adx',
    'rsi',
    'bollinger',
    'percentileRank',
    'obv',
    'cmf',
    'costDrag',
    'trueEV',
    'kellyCriterion',
    'scanEmaRange',
    'detectSFP_Advanced',
    'detectSFP_Institutional_Advanced',
    'dynamicAsymmetricTargets',
    'estimateLiquidation',
    'classifyAssetTier',
    'cusumFilter',
    'vpin',
    'rollMeasure',
    'amihudIlliquidity',
    'amihudProfile',
    'liquidationPressure',
    'pearsonCorrelation',
    'immediateSensitivityIndicator',
    'detectMarketStructure',
    'calculateTemporalBarrier'
  ];

  expectedFunctions.forEach(name => {
    assert.equal(
      typeof QuantMath[name],
      'function',
      `${name} must remain callable`
    );
  });
});

test('MACD resolves both EMA dependencies used by HUD and scanner', () => {
  const closes = Array.from(
    { length: 80 },
    (_, index) => 100 + index * 0.25
  );

  const result = QuantMath.macd(closes, 12, 26, 9);

  assert.equal(Number.isFinite(result.macd), true);
  assert.equal(Number.isFinite(result.signal), true);
  assert.equal(Number.isFinite(result.hist), true);
});

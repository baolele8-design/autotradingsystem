import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateL3 } from './regime.js';

const base = {
  avgVolume20: 100,
  currentPrice: 100,
  ema20: { value: 100 },
  fundingSlope: 0,
  isBearishSFP: false,
  isBullishSFP: false,
  lastClosedVolume: 100,
  liqLongRatio: 0.2,
  liqShortRatio: 0,
  liquidationCoverageReady: false,
  liquidationReady: false,
  liquidationStale: true,
  obi: 0.5,
  vpinValue: 0
};

test('L3 ignores liquidation ratios while stream coverage is warming', () => {
  const result = evaluateL3(base, 'Trend Up', 'Normal');

  assert.equal(result.l3, 'Quiet');
  assert.equal(result.liqSeverity, 0);
});

test('L3 accepts a ratio only after continuous coverage is ready', () => {
  const result = evaluateL3(
    {
      ...base,
      liquidationCoverageReady: true,
      liquidationReady: true,
      liquidationStale: false
    },
    'Trend Up',
    'Normal'
  );

  assert.equal(result.l3, 'Sweep Low');
  assert.equal(result.liqSeverity, 70);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateBtcEntryGate } from './btcEntryGate.js';

test('blocks SHORT Tier 2 altcoin when BTC regime is downtrend', () => {
  const result = evaluateBtcEntryGate({
    direction: 'SHORT',
    assetTier: 'Tier 2: Liquid Majors',
    btcRegime: 'Downtrend'
  });

  assert.equal(result.blocked, true);
  assert.match(result.reason, /SHORT/);
});

test('blocks SHORT Tier 1 altcoin when BTC regime is downtrend', () => {
  const result = evaluateBtcEntryGate({
    direction: 'SHORT',
    assetTier: 'Tier 1: Macro',
    btcRegime: 'Strong Trend Down'
  });

  assert.equal(result.blocked, true);
});

test('does not block LONG when BTC regime is downtrend', () => {
  const result = evaluateBtcEntryGate({
    direction: 'LONG',
    assetTier: 'Tier 2: Liquid Majors',
    btcRegime: 'Downtrend'
  });

  assert.equal(result.blocked, false);
});

test('does not block SHORT Tier 2 when BTC regime is bullish or range', () => {
  for (const btcRegime of ['Uptrend', 'Strong Trend Up', 'Range', 'Sideways']) {
    const result = evaluateBtcEntryGate({
      direction: 'SHORT',
      assetTier: 'Tier 2: Liquid Majors',
      btcRegime
    });
    assert.equal(result.blocked, false, `expected ${btcRegime} to pass`);
  }
});

test('does not block SHORT Tier 3 or Tier 4 in a downtrend', () => {
  for (const assetTier of ['Tier 3: Mid-Cap Equities', 'Tier 4: Nano/High-Risk']) {
    const result = evaluateBtcEntryGate({
      direction: 'SHORT',
      assetTier,
      btcRegime: 'Downtrend'
    });
    assert.equal(result.blocked, false);
  }
});

test('never blocks BTCUSDT', () => {
  const result = evaluateBtcEntryGate({
    direction: 'SHORT',
    assetTier: 'Tier 1: Macro',
    btcRegime: 'Downtrend',
    symbol: 'BTCUSDT'
  });

  assert.equal(result.blocked, false);
});

test('unknown or missing BTC regime passes with a warning', () => {
  for (const btcRegime of [null, undefined, '', 'SomeWeirdLabel']) {
    const result = evaluateBtcEntryGate({
      direction: 'SHORT',
      assetTier: 'Tier 2: Liquid Majors',
      btcRegime
    });
    assert.equal(result.blocked, false);
    assert.equal(result.warn, true);
  }
});

test('reports the estimated avoidable loss in R multiples when blocked', () => {
  const result = evaluateBtcEntryGate({
    direction: 'SHORT',
    assetTier: 'Tier 2: Liquid Majors',
    btcRegime: 'Downtrend'
  });

  assert.equal(result.blocked, true);
  assert.equal(typeof result.estimatedAvgR, 'number');
  assert.ok(result.estimatedAvgR < 0, 'estimated loss must be negative');
});

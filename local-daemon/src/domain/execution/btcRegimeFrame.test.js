import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BTC_REGIME_FRAMES,
  btcRegimeFrameFor,
  resolveBtcRegime,
  buildBtcRegimeSnapshot
} from './btcRegimeFrame.js';

test('btcRegimeFrameFor maps intervals below 4h to the fixed 4h frame', () => {
  for (const interval of ['5m', '15m', '1h', '4h']) {
    assert.equal(btcRegimeFrameFor(interval), '4h', `${interval} -> 4h`);
  }
});

test('btcRegimeFrameFor maps intervals at 1d and above to the fixed 1d frame', () => {
  assert.equal(btcRegimeFrameFor('1d'), '1d');
  assert.equal(btcRegimeFrameFor('1w'), '1d');
});

test('btcRegimeFrameFor falls back to 4h for unknown or empty intervals', () => {
  assert.equal(btcRegimeFrameFor(''), '4h');
  assert.equal(btcRegimeFrameFor(null), '4h');
  assert.equal(btcRegimeFrameFor(undefined), '4h');
  assert.equal(btcRegimeFrameFor('2h'), '4h');
});

test('resolveBtcRegime reads only the fixed-frame keys, not the trade interval', () => {
  const cache = new Map([
    ['15m', 'Uptrend'],
    ['1h', 'Downtrend'],
    ['4h', 'Range'],
    ['1d', 'Downtrend']
  ]);

  // 15m trade must read the 4h frame (Range), NOT the 15m entry (Uptrend).
  assert.equal(resolveBtcRegime(cache, '15m'), 'Range');
  assert.equal(resolveBtcRegime(cache, '1h'), 'Range');
  assert.equal(resolveBtcRegime(cache, '4h'), 'Range');
  assert.equal(resolveBtcRegime(cache, '1d'), 'Downtrend');
  assert.equal(resolveBtcRegime(cache, '1w'), 'Downtrend');
});

test('resolveBtcRegime returns null when the fixed frame has no value', () => {
  const cache = new Map([['1d', 'Uptrend']]);
  assert.equal(resolveBtcRegime(cache, '15m'), null);
  assert.equal(resolveBtcRegime(new Map(), '1h'), null);
  assert.equal(resolveBtcRegime(null, '4h'), null);
  assert.equal(resolveBtcRegime(new Map(), null), null);
});

test('BTC_REGIME_FRAMES exports exactly the two fixed frames', () => {
  assert.deepEqual(BTC_REGIME_FRAMES, ['4h', '1d']);
});

test('buildBtcRegimeSnapshot surfaces both frames + dominance + bleeding', () => {
  const regimeCache = new Map([
    ['4h', 'Range'],
    ['1d', 'Downtrend']
  ]);
  const domCache = new Map([
    ['4h', { slope: 0.42 }],
    ['1d', { slope: -0.1 }]
  ]);

  const snap = buildBtcRegimeSnapshot({
    regimeCache,
    domCache,
    btcDominance: 58.5
  });

  assert.equal(snap.regime4h, 'Range');
  assert.equal(snap.regime1d, 'Downtrend');
  assert.equal(snap.domSlope4h, 0.42);
  assert.equal(snap.domSlope1d, -0.1);
  assert.equal(snap.btcDomValue, 58.5);
  // regime.js:404-417 — dom > 50 && slope > 0.3 → bleeding
  assert.equal(snap.isAltcoinBleeding, true);
});

test('buildBtcRegimeSnapshot bleeding is false when dominance slope is low', () => {
  const snap = buildBtcRegimeSnapshot({
    regimeCache: new Map([['4h', 'Uptrend'], ['1d', 'Uptrend']]),
    domCache: new Map([['4h', { slope: 0.2 }], ['1d', { slope: 0.1 }]]),
    btcDominance: 58.5
  });
  assert.equal(snap.isAltcoinBleeding, false);
});

test('buildBtcRegimeSnapshot tolerates missing caches (fail-open nulls)', () => {
  const snap = buildBtcRegimeSnapshot({});
  assert.equal(snap.regime4h, null);
  assert.equal(snap.regime1d, null);
  assert.equal(snap.domSlope4h, null);
  assert.equal(snap.domSlope1d, null);
  assert.equal(snap.btcDomValue, null);
  assert.equal(snap.isAltcoinBleeding, false);
});
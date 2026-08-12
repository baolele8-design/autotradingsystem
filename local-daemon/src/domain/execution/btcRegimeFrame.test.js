import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BTC_REGIME_FRAMES,
  btcRegimeFrameFor,
  resolveBtcRegime,
  resolveBtcStructure,
  classifyBtcBias,
  createBtcBiasStats,
  accumulateBtcBiasStats,
  formatBtcBiasSummary,
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
  // regime.js:404-417 â€” dom > 50 && slope > 0.3 â†’ bleeding
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
// ============================================================
// F-E1b (2026-08-12): regime cache stores objects {regime, msbState, isSFP,
// lastSL, lastSH}; readers must stay dual-type (object -> .regime, string ->
// string) so the old string cache contract keeps working.
// ============================================================

const objectCache = new Map([
  ['4h', { regime: 'Uptrend', msbState: 'Bullish_MSB', isSFP: null, lastSL: { index: 100, price: 90 }, lastSH: { index: 120, price: 110 } }],
  ['1d', { regime: 'Downtrend', msbState: 'Bearish_MSB', isSFP: 'Bullish_SFP', lastSL: { index: 5, price: 8 }, lastSH: { index: 9, price: 12 } }]
]);

test('F-E1b resolveBtcRegime reads .regime from object cache entries', () => {
  assert.equal(resolveBtcRegime(objectCache, '15m'), 'Uptrend');
  assert.equal(resolveBtcRegime(objectCache, '1h'), 'Uptrend');
  assert.equal(resolveBtcRegime(objectCache, '4h'), 'Uptrend');
  assert.equal(resolveBtcRegime(objectCache, '1d'), 'Downtrend');
  assert.equal(resolveBtcRegime(objectCache, '1w'), 'Downtrend');
});

test('F-E1b resolveBtcRegime keeps reading plain string entries (regression)', () => {
  const cache = new Map([['4h', 'Range'], ['1d', 'Downtrend']]);
  assert.equal(resolveBtcRegime(cache, '15m'), 'Range');
  assert.equal(resolveBtcRegime(cache, '1d'), 'Downtrend');
});

test('F-E1b resolveBtcRegime returns null for malformed object entries (no throw)', () => {
  const cache = new Map([['4h', { msbState: 'Bullish_MSB' }], ['1d', 42]]);
  assert.equal(resolveBtcRegime(cache, '15m'), null);
  assert.equal(resolveBtcRegime(cache, '1d'), null);
});

test('F-E1b resolveBtcStructure returns the full structure for the fixed frame', () => {
  const structure = resolveBtcStructure(objectCache, '15m');
  assert.deepEqual(structure, {
    regime: 'Uptrend',
    msbState: 'Bullish_MSB',
    isSFP: null,
    lastSL: { index: 100, price: 90 },
    lastSH: { index: 120, price: 110 }
  });
  const structure1d = resolveBtcStructure(objectCache, '1d');
  assert.equal(structure1d.isSFP, 'Bullish_SFP');
  assert.equal(structure1d.regime, 'Downtrend');
});

test('F-E1b resolveBtcStructure returns null for string entries, missing frame, or null cache', () => {
  const stringCache = new Map([['4h', 'Uptrend']]);
  assert.equal(resolveBtcStructure(stringCache, '15m'), null);
  assert.equal(resolveBtcStructure(new Map(), '15m'), null);
  assert.equal(resolveBtcStructure(null, '15m'), null);
});

test('F-E1b classifyBtcBias: two frames aligned with direction -> ALIGNED', () => {
  assert.equal(classifyBtcBias({ direction: 'LONG', regime4h: 'Uptrend', regime1d: 'Uptrend' }), 'ALIGNED');
  assert.equal(classifyBtcBias({ direction: 'SHORT', regime4h: 'Downtrend', regime1d: 'Downtrend' }), 'ALIGNED');
});

test('F-E1b classifyBtcBias: frames disagree or oppose direction -> MISALIGNED', () => {
  assert.equal(classifyBtcBias({ direction: 'LONG', regime4h: 'Uptrend', regime1d: 'Downtrend' }), 'MISALIGNED');
  assert.equal(classifyBtcBias({ direction: 'LONG', regime4h: 'Downtrend', regime1d: 'Uptrend' }), 'MISALIGNED');
  assert.equal(classifyBtcBias({ direction: 'SHORT', regime4h: 'Downtrend', regime1d: 'Uptrend' }), 'MISALIGNED');
  // both frames aligned with each other but against the trade direction
  assert.equal(classifyBtcBias({ direction: 'LONG', regime4h: 'Downtrend', regime1d: 'Downtrend' }), 'MISALIGNED');
  assert.equal(classifyBtcBias({ direction: 'SHORT', regime4h: 'Uptrend', regime1d: 'Uptrend' }), 'MISALIGNED');
});

test('F-E1b classifyBtcBias: Range and Sideways both map to NEUTRAL', () => {
  assert.equal(classifyBtcBias({ direction: 'LONG', regime4h: 'Range', regime1d: 'Uptrend' }), 'NEUTRAL');
  assert.equal(classifyBtcBias({ direction: 'LONG', regime4h: 'Sideways', regime1d: 'Uptrend' }), 'NEUTRAL');
  assert.equal(classifyBtcBias({ direction: 'LONG', regime4h: 'Uptrend', regime1d: 'Range' }), 'NEUTRAL');
  assert.equal(classifyBtcBias({ direction: 'SHORT', regime4h: 'Sideways', regime1d: 'Sideways' }), 'NEUTRAL');
});

test('F-E1b classifyBtcBias: null/unknown regime or direction -> NEUTRAL', () => {
  assert.equal(classifyBtcBias({ direction: 'LONG', regime4h: null, regime1d: 'Uptrend' }), 'NEUTRAL');
  assert.equal(classifyBtcBias({ direction: 'LONG', regime4h: 'Uptrend', regime1d: null }), 'NEUTRAL');
  assert.equal(classifyBtcBias({ direction: 'LONG', regime4h: null, regime1d: null }), 'NEUTRAL');
  assert.equal(classifyBtcBias({ direction: 'FLAT', regime4h: 'Uptrend', regime1d: 'Uptrend' }), 'NEUTRAL');
  assert.equal(classifyBtcBias({}), 'NEUTRAL');
});

test('F-E1b buildBtcRegimeSnapshot reads .regime from object cache entries', () => {
  const snap = buildBtcRegimeSnapshot({
    regimeCache: new Map([
      ['4h', { regime: 'Range', msbState: 'None' }],
      ['1d', { regime: 'Uptrend', msbState: 'Bullish_MSB' }]
    ]),
    domCache: new Map([['4h', { slope: 0.2 }]]),
    btcDominance: 55
  });
  assert.equal(snap.regime4h, 'Range');
  assert.equal(snap.regime1d, 'Uptrend');
  assert.equal(snap.isAltcoinBleeding, false);
});

test('F-E1b accumulateBtcBiasStats + formatBtcBiasSummary renders per-frame regime distribution', () => {
  const stats = createBtcBiasStats();
  accumulateBtcBiasStats(stats, { direction: 'LONG', regime4h: 'Uptrend', regime1d: 'Uptrend' });
  accumulateBtcBiasStats(stats, { direction: 'LONG', regime4h: 'Uptrend', regime1d: 'Downtrend' });
  accumulateBtcBiasStats(stats, { direction: 'SHORT', regime4h: 'Sideways', regime1d: null });

  assert.deepEqual(stats.bias, { ALIGNED: 1, MISALIGNED: 1, NEUTRAL: 1 });
  assert.deepEqual(stats.regimes['4h'], { Uptrend: 2, Downtrend: 0, Range: 0, Sideways: 1, null: 0 });
  assert.deepEqual(stats.regimes['1d'], { Uptrend: 1, Downtrend: 1, Range: 0, Sideways: 0, null: 1 });

  const line = formatBtcBiasSummary(stats);
  assert.equal(
    line,
    '[BTC BIAS SHADOW] 4h: Uptrend 2 Downtrend 0 Range 0 Sideways 1 null 0 | 1d: Uptrend 1 Downtrend 1 Range 0 Sideways 0 null 1 | bias: ALIGNED 1 MISALIGNED 1 NEUTRAL 1'
  );
});

test('F-E1b accumulateBtcBiasStats tolerates invalid frames (no throw, no count)', () => {
  const stats = createBtcBiasStats();
  assert.doesNotThrow(() => {
    accumulateBtcBiasStats(stats, { direction: 'LONG', regime4h: 'Bogus', regime1d: 'Uptrend' });
    accumulateBtcBiasStats(null, { direction: 'LONG', regime4h: 'Uptrend' });
  });
  // unknown regimes are bucketed as null (fail-open, no throw)
  const line = formatBtcBiasSummary(stats);
  assert.ok(line.includes('4h: Uptrend 0 Downtrend 0 Range 0 Sideways 0 null 1'));
  assert.equal(formatBtcBiasSummary(stats, { minCount: 2 }), null);
});

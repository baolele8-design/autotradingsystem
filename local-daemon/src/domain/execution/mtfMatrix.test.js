import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  MTF_LADDER,
  evaluateMtfMatrix,
  createMtfStats,
  accumulateMtfStats,
  formatMtfSummary
} from './mtfMatrix.js';

// Fixtures — frames chấp nhận cả object {regime, ...} (shape của
// detectMarketStructure / resolveBtcStructure) và string regime.
const UP = { regime: 'Uptrend' };
const DOWN = { regime: 'Downtrend' };
const LONG = { direction: 'LONG', entryInterval: '15m' };
const frames = (over = {}) => ({
  entry: null,
  bias: null,
  structure: null,
  btc4h: null,
  btc1d: null,
  ...over
});

// 1. STRONG_ALIGNED: 5 phiếu cùng hướng + topFrame cùng hướng
test('STRONG_ALIGNED: 5 phiếu cùng hướng + topFrame cùng → STRONG_ALIGNED', () => {
  const result = evaluateMtfMatrix({
    ...LONG,
    frames: frames({ entry: UP, bias: UP, structure: UP, btc4h: UP, btc1d: UP })
  });
  assert.equal(result.alignment.verdict, 'STRONG_ALIGNED');
  assert.equal(result.alignment.countAligned, 5);
  assert.equal(result.alignment.countMisaligned, 0);
  assert.equal(result.alignment.countNeutral, 0);
  assert.equal(result.alignment.totalDirectional, 5);
  assert.equal(result.alignment.topFrame, 'btc1d');
  assert.equal(result.alignment.htfConfirms, 3);
  assert.equal(result.alignment.counterTrendEntry, false);
  assert.deepEqual(result.advice, { action: 'NONE', softBias: 1 });
});

// 2. CRITIC-1: BTC 1d là frame quyền lực nhất — OPPOSE chặn STRONG + hạ ALIGNED→MIXED
test('CRITIC-1: coin 3 ô ALIGNED (agree=3) nhưng btc1d OPPOSE → MIXED (không ALIGNED/STRONG)', () => {
  const result = evaluateMtfMatrix({
    ...LONG,
    frames: frames({ entry: UP, bias: UP, structure: UP, btc1d: DOWN })
  });
  assert.equal(result.alignment.verdict, 'MIXED');
  assert.notEqual(result.alignment.verdict, 'ALIGNED');
  assert.notEqual(result.alignment.verdict, 'STRONG_ALIGNED');
  assert.equal(result.alignment.countAligned, 3);
  assert.equal(result.alignment.countMisaligned, 1);
});

// 3. CRITIC-5: tie-break topFrame — agree===oppose && topFrame AGREE → ALIGNED
test('CRITIC-5: agree=2 oppose=2 + topFrame AGREE → ALIGNED (tie-break topFrame)', () => {
  const result = evaluateMtfMatrix({
    ...LONG,
    frames: frames({ entry: UP, structure: DOWN, btc4h: DOWN, btc1d: UP })
  });
  assert.equal(result.alignment.verdict, 'ALIGNED');
  assert.equal(result.alignment.topFrame, 'btc1d');
  assert.equal(result.alignment.countAligned, 2);
  assert.equal(result.alignment.countMisaligned, 2);
});

// 4. ALIGNED boundary: agree=2 oppose=1 → ALIGNED (không STRONG vì agree<3)
test('ALIGNED boundary: agree=2 oppose=1 → ALIGNED (không STRONG vì agree<3)', () => {
  const result = evaluateMtfMatrix({
    ...LONG,
    frames: frames({ entry: UP, structure: DOWN, btc4h: UP })
  });
  assert.equal(result.alignment.verdict, 'ALIGNED');
  assert.equal(result.alignment.countAligned, 2);
  assert.equal(result.alignment.countMisaligned, 1);
  assert.equal(result.alignment.topFrame, 'btc4h');
});

// 5. MISALIGNED + counterTrendEntry: LONG + entry Downtrend + 3 ô DOWN
test('MISALIGNED + counterTrendEntry: LONG + entry Downtrend + 3 ô DOWN → MISALIGNED + softBias=-1', () => {
  const result = evaluateMtfMatrix({
    ...LONG,
    frames: frames({ entry: DOWN, bias: DOWN, structure: DOWN })
  });
  assert.equal(result.alignment.verdict, 'MISALIGNED');
  assert.equal(result.alignment.counterTrendEntry, true);
  assert.equal(result.alignment.countMisaligned, 3);
  assert.equal(result.alignment.countAligned, 0);
  assert.equal(result.advice.action, 'CAUTION');
  assert.equal(result.advice.softBias, -1);
  assert.equal(result.advice.counterTrend, true);
});

// 6. MIXED 1-1 (topFrame không AGREE) → check MSB_AT_ENTRY
test('MIXED 1-1: topFrame không AGREE → MIXED + check [MSB_AT_ENTRY, SFP_AT_ENTRY]', () => {
  const result = evaluateMtfMatrix({
    ...LONG,
    frames: frames({ entry: UP, structure: DOWN })
  });
  assert.equal(result.alignment.verdict, 'MIXED');
  assert.deepEqual(result.advice, {
    action: 'CAUTION',
    check: ['MSB_AT_ENTRY', 'SFP_AT_ENTRY']
  });
});

// 7. NEUTRAL fail-open: toàn null / 1 phiếu → NEUTRAL + neutralVotes đúng + không throw
test('NEUTRAL fail-open: toàn null / 1 phiếu → NEUTRAL + neutralVotes đúng + không throw', () => {
  const empty = evaluateMtfMatrix({ ...LONG, frames: frames({}) });
  assert.equal(empty.alignment.verdict, 'NEUTRAL');
  assert.equal(empty.alignment.countNeutral, 5);
  assert.equal(empty.advice.neutralVotes, 5);
  assert.equal(empty.advice.action, 'NONE');

  const one = evaluateMtfMatrix({ ...LONG, frames: frames({ entry: UP }) });
  assert.equal(one.alignment.verdict, 'NEUTRAL');
  assert.equal(one.alignment.totalDirectional, 1);
  assert.equal(one.advice.neutralVotes, 4);

  // frames thiếu key / frames undefined — không throw
  const missing = evaluateMtfMatrix({ direction: 'LONG', entryInterval: '1h', frames: { entry: UP } });
  assert.equal(missing.alignment.verdict, 'NEUTRAL');
  const noFrames = evaluateMtfMatrix({ direction: 'LONG', entryInterval: '1h' });
  assert.equal(noFrames.alignment.verdict, 'NEUTRAL');
});

// 8. Sideways === Range: cả 2 không phiếu
test('Sideways === Range: cả 2 không phiếu', () => {
  const result = evaluateMtfMatrix({
    ...LONG,
    frames: frames({
      entry: { regime: 'Sideways' },
      bias: 'Range',
      structure: { regime: 'Range' }
    })
  });
  assert.equal(result.alignment.verdict, 'NEUTRAL');
  assert.equal(result.alignment.countNeutral, 5);
  assert.equal(result.frames.entry, null);
  assert.equal(result.frames.bias, null);
  assert.equal(result.frames.structure, null);
});

// 9. Top-frame ưu tiên: btc1d > btc4h > structure > bias > entry
test('Top-frame ưu tiên: btc1d > btc4h > structure > bias > entry', () => {
  const topOf = (over) =>
    evaluateMtfMatrix({ ...LONG, frames: frames(over) }).alignment.topFrame;
  assert.equal(topOf({ entry: UP, btc1d: UP }), 'btc1d');
  assert.equal(topOf({ entry: UP, btc4h: UP }), 'btc4h');
  assert.equal(topOf({ entry: UP, structure: UP }), 'structure');
  assert.equal(topOf({ entry: null, bias: UP }), 'bias');
  assert.equal(topOf({ entry: UP }), 'entry');
  assert.equal(evaluateMtfMatrix({ ...LONG, frames: frames({}) }).alignment.topFrame, null);
});

// 10. Ladder: 4 entry interval → đúng bias/structure
test('Ladder: 4 entry interval → đúng bias/structure', () => {
  assert.deepEqual(MTF_LADDER['15m'], { bias: '1h', structure: '4h' });
  assert.deepEqual(MTF_LADDER['1h'], { bias: '4h', structure: '1d' });
  assert.deepEqual(MTF_LADDER['4h'], { bias: '1d', structure: '1w' });
  assert.deepEqual(MTF_LADDER['1d'], { bias: '1w', structure: '1M' });
});

// 11. Early-return shape indicators.js:354-360 (thiếu lastSL/lastSH, key 'sfp')
// → chuẩn hoá null, không throw
test('Early-return shape (thiếu lastSL/lastSH, key sfp) → chuẩn hoá null, không throw', () => {
  const earlyReturn = { regime: 'Sideways', msbState: 'None', sfp: false };
  const result = evaluateMtfMatrix({
    ...LONG,
    frames: frames({
      entry: earlyReturn,
      bias: { regime: 'Uptrend', msbState: 'None', isSFP: false },
      structure: earlyReturn
    })
  });
  assert.equal(result.alignment.verdict, 'NEUTRAL');
  assert.equal(result.frames.entry, null);
  assert.equal(result.frames.structure, null);
  assert.equal(result.alignment.countAligned, 1);
  assert.equal(result.alignment.countNeutral, 4);
});

// 12. formatMtfSummary: null khi chưa đủ minCount; NEUTRAL rate +
// counterTrendEntry per-interval hiện diện
test('formatMtfSummary: null khi chưa đủ minCount; NEUTRAL rate + counterTrendEntry per-interval', () => {
  const stats = createMtfStats();
  accumulateMtfStats(stats, { interval: '15m', verdict: 'NEUTRAL', counterTrendEntry: false });
  accumulateMtfStats(stats, { interval: '15m', verdict: 'NEUTRAL', counterTrendEntry: false });
  accumulateMtfStats(stats, { interval: '1h', verdict: 'STRONG_ALIGNED', counterTrendEntry: true });

  assert.equal(formatMtfSummary(stats, { minCount: 100 }), null);

  const line = formatMtfSummary(stats, { minCount: 1 });
  assert.ok(line, 'summary must render above minCount');
  assert.match(line, /\[MTF MATRIX\]/);
  assert.match(line, /NEUTRAL 2/);
  assert.match(line, /STRONG_ALIGNED 1/);
  // NEUTRAL rate global: 2/3 = 66.7%
  assert.match(line, /NEUTRAL 2 \(66\.7%\)/);
  // per-interval: 15m NEUTRAL 2/2 = 100.0%; 1h có counterTrendEntry
  assert.match(line, /15m/);
  assert.match(line, /15m NEUTRAL 2 \(100\.0%\)/);
  assert.match(line, /1h/);
  assert.match(line, /ctr 1/);
});

// 14. CRITIC-3: frameDirection import từ btcRegimeFrame — không duplicate local
test('CRITIC-3: frameDirection import từ btcRegimeFrame — không định nghĩa local', () => {
  const source = readFileSync(new URL('./mtfMatrix.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /import\s*\{[^}]*\bframeDirection\b[^}]*\}\s*from\s*['"]\.\/btcRegimeFrame\.js['"]/,
    'frameDirection must be imported from btcRegimeFrame.js'
  );
  assert.ok(
    !/\bconst\s+frameDirection\s*=/.test(source),
    'mtfMatrix.js must not define frameDirection locally'
  );
});

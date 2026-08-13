import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createH2RealizedStats,
  accumulateH2Realized,
  formatH2RealizedSummary
} from './h2RealizedTelemetry.js';

// 2026-08-13: [H2 REALIZED] log per-candidate (~560-1100 dòng/cycle =
// ~1M dòng/ngày) gộp thành per-cycle summary theo (direction, version) —
// pattern [BTC BIAS SHADOW] (btcRegimeFrame.js). 1 dòng/key/cycle.
test('formatH2RealizedSummary: accumulate nhiều candidate → đúng 1 dòng per (direction, version)', () => {
  const stats = createH2RealizedStats();
  for (let i = 0; i < 40; i++) {
    accumulateH2Realized(stats, { direction: 'LONG', version: 'v1.5.2-auto', realizedEV: -0.035 });
  }
  for (let i = 0; i < 12; i++) {
    accumulateH2Realized(stats, { direction: 'SHORT', version: 'v1.5.2-auto', realizedEV: 0.1 });
  }
  accumulateH2Realized(stats, { direction: 'LONG', version: 'v1.5.1', realizedEV: -0.2 });

  const lines = formatH2RealizedSummary(stats).split('\n');
  assert.equal(lines.length, 3, 'đúng 1 dòng per (direction, version) — không per-candidate');
  const long152 = lines.find(l => l.includes('direction=LONG') && l.includes('version=v1.5.2-auto'));
  assert.ok(long152, 'phải có summary LONG v1.5.2-auto');
  assert.match(long152, /n=40 /, 'n = số candidate đã accumulate');
  assert.match(long152, /avgEV=-0\.035R/, 'avgEV = trung bình EV của candidate');
  assert.ok(!/EV=/.test(lines[0].replace('avgEV', '')), 'KHÔNG còn format per-candidate EV=...');
});

test('accumulateH2Realized: version có dấu | không vỡ format (pLog.strategy_version)', () => {
  const stats = createH2RealizedStats();
  accumulateH2Realized(stats, { direction: 'LONG', version: 'v1.5.2-auto|liquidity-v2', realizedEV: 0.5 });
  const line = formatH2RealizedSummary(stats);
  assert.match(line, /version=v1\.5\.2-auto\|liquidity-v2 /);
  assert.match(line, /avgEV=0\.500R/);
});

test('accumulateH2Realized: realizedEV không hợp lệ → bỏ qua (không NaN trong summary)', () => {
  const stats = createH2RealizedStats();
  accumulateH2Realized(stats, { direction: 'LONG', version: 'v1', realizedEV: NaN });
  accumulateH2Realized(stats, { direction: 'LONG', version: 'v1', realizedEV: undefined });
  accumulateH2Realized(stats, { direction: 'LONG', version: 'v1', realizedEV: 1 });
  assert.equal(formatH2RealizedSummary(stats), '[H2 REALIZED] direction=LONG version=v1 n=1 avgEV=1.000R (telemetry only — gate OR)');
});

test('formatH2RealizedSummary: không có candidate → null (không log)', () => {
  assert.equal(formatH2RealizedSummary(createH2RealizedStats()), null);
  assert.equal(formatH2RealizedSummary(null), null);
  assert.equal(formatH2RealizedSummary(undefined), null);
});

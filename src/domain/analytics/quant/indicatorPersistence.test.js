import assert from 'node:assert/strict';
import test from 'node:test';

import { numberOrNull } from './indicatorPersistence.js';

// 2026-08-13 regression: autoBot.js/scanner stamp/tradeLedger persist
// indicators via parseFloat(x || 0) — indicator MISSING bị bơm thành 0.
// 0 là giá trị thật nhưng làm confound mọi gate đọc lại từ DB:
// vwap=0 → h_vwap chặn 100% LONG + pass 100% SHORT; hurst=0 → h_hurst
// chặn nhầm trend-family; cvd=0 → h_cvd fail-open méo. Missing → null.
test('numberOrNull: missing/invalid indicator → null (KHÔNG 0)', () => {
  assert.equal(numberOrNull(undefined), null);
  assert.equal(numberOrNull(null), null);
  assert.equal(numberOrNull(''), null);
  assert.equal(numberOrNull('   '), null);
  assert.equal(numberOrNull('abc'), null);
  assert.equal(numberOrNull(NaN), null);
});

test('numberOrNull: giá trị hợp lệ giữ nguyên (kể cả 0)', () => {
  assert.equal(numberOrNull(0), 0);
  assert.equal(numberOrNull('0'), 0);
  assert.equal(numberOrNull(99.5), 99.5);
  assert.equal(numberOrNull('101.25'), 101.25);
  assert.equal(numberOrNull('-3.5'), -3.5);
});

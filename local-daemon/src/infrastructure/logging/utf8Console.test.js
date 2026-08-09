import test from 'node:test';
import assert from 'node:assert/strict';

import { repairMojibake } from './utf8Console.js';

test('repairs Vietnamese text decoded as Windows-1252', () => {
  const broken =
    'M\u00e1\u00bb\u0178 lu\u00e1\u00bb\u201cng ' +
    'c\u00e1\u00ba\u00a5p d\u00e1\u00bb\u00af ' +
    'li\u00e1\u00bb\u2021u';

  assert.equal(
    repairMojibake(broken),
    'Mở luồng cấp dữ liệu'
  );
});

test('repairs emoji and Vietnamese in the same old log', () => {
  const broken =
    '\u00f0\u0178\u201d\u00a5 ' +
    '\u00c4\u0090\u00c3\u00a3 ' +
    'm\u00e1\u00bb\u0178 lu\u00e1\u00bb\u201cng';

  assert.equal(repairMojibake(broken), '🔥 Đã mở luồng');
});

test('leaves valid Vietnamese and emoji unchanged', () => {
  const valid = '🚀 Hoàn tất Epoch. Đã xử lý dữ liệu.';
  assert.equal(repairMojibake(valid), valid);
});

test('repairs a broken segment beside valid Unicode', () => {
  const mixed =
    '✅ HUD: M\u00e1\u00bb\u0178 ' +
    'lu\u00e1\u00bb\u201cng BTCUSDT';

  assert.equal(repairMojibake(mixed), '✅ HUD: Mở luồng BTCUSDT');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMarketDepthUrl
} from './matrixScannerService.js';

const VALID_FUTURES_DEPTH_LIMITS = new Set([5, 10, 20, 50, 100, 500, 1000]);

test('builds a market depth URL with a Binance Futures-valid limit', () => {
  const url = buildMarketDepthUrl('AVAXUSDT');
  assert.match(url, /^https:\/\/fapi\.binance\.com\/fapi\/v1\/depth\?symbol=AVAXUSDT&limit=\d+$/);
  const limit = Number(new URL(url).searchParams.get('limit'));
  assert.ok(
    VALID_FUTURES_DEPTH_LIMITS.has(limit),
    `limit=${limit} is not a valid Binance Futures depth limit`
  );
});

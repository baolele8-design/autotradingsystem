// TD-005 regression guard (2026-08-12)
// The frontend has no .jsx test runner (`npm test` only picks up *.test.js),
// so the daemon proxy contract for this hook is enforced structurally:
//   1. this source-inspection test (fails if a direct Binance fetch returns),
//   2. scripts/check-architecture.mjs (fails on direct https://(fapi|api).binance.com),
//   3. registerRoutes.test.js proxy allowlist guard for both endpoints used here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.join(__dirname, 'useExchangeConfig.js');
const source = fs.readFileSync(hookPath, 'utf8');

test('TD-005: useExchangeConfig does not fetch Binance directly', () => {
  assert.doesNotMatch(
    source,
    /fetch\s*\(\s*[`'"]https:\/\/(?:fapi|api)\.binance\.com/,
    'hook must route through the daemon proxy (/api/binance), not direct Binance fetch'
  );
});

test('TD-005: exchangeInfo is read through the daemon proxy', () => {
  assert.match(
    source,
    /\/api\/binance\?path=\/fapi\/v1\/exchangeInfo/,
    'hook must request /fapi/v1/exchangeInfo via /api/binance?path=...'
  );
});

test('TD-005: ticker 24hr is read through the daemon proxy', () => {
  assert.match(
    source,
    /\/api\/binance\?path=\/fapi\/v1\/ticker\/24hr/,
    'hook must request /fapi/v1/ticker/24hr via /api/binance?path=...'
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateNewEntrySymbol,
  isNewEntrySymbolAllowed
} from './symbolEntryPolicy.js';

test('new-entry policy blocks every 1000-prefixed contract', () => {
  for (const symbol of [
    '1000XECUSDT',
    '1000PEPEUSDT',
    '1000000MOGUSDT',
    ' 1000xecusdt '
  ]) {
    const result = evaluateNewEntrySymbol(symbol);
    assert.equal(result.allowed, false, symbol);
    assert.equal(result.code, 'BLOCKED_SYMBOL_PREFIX');
  }
});

test('new-entry policy preserves the exact meme blacklist and allows normal symbols', () => {
  assert.equal(isNewEntrySymbolAllowed('DOGEUSDT'), false);
  assert.equal(isNewEntrySymbolAllowed('PNUTUSDT'), false);
  assert.equal(isNewEntrySymbolAllowed('XECUSDT'), true);
  assert.equal(isNewEntrySymbolAllowed('BTCUSDT'), true);
});

test('new-entry policy fails closed for an absent symbol', () => {
  assert.deepEqual(evaluateNewEntrySymbol(), {
    allowed: false,
    code: 'INVALID_SYMBOL',
    symbol: ''
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_TRADE_STATS,
  calculateTradeStats
} from './tradeStats.js';

test('keeps the cold-start trade statistics unchanged', () => {
  assert.deepEqual(calculateTradeStats([], 'BTCUSDT'), {
    ...EMPTY_TRADE_STATS
  });
});

test('calculates the existing R-multiple statistics by symbol', () => {
  const result = calculateTradeStats(
    [
      {
        symbol: 'BTCUSDT',
        status: 'WIN',
        pnl_usd: 20,
        risk_amount_usd: 10
      },
      {
        symbol: 'BTCUSDT',
        status: 'LOSS',
        pnl_usd: -10,
        risk_amount_usd: 10
      },
      {
        symbol: 'ETHUSDT',
        status: 'WIN',
        pnl_usd: 100,
        risk_amount_usd: 10
      }
    ],
    'BTCUSDT'
  );

  assert.deepEqual(result, {
    totalClosed: 2,
    winRate: 0.5,
    avgWinR: 2,
    avgLossR: 1,
    historicalRR: 2,
    hasEnoughData: false
  });
});

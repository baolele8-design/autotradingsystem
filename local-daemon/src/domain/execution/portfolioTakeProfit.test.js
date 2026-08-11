import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PORTFOLIO_TP_THRESHOLD,
  PORTFOLIO_TP_TOLERANCE,
  computeGreenTotal,
  isEngineOwnedPosition,
  shouldTriggerPortfolioTp
} from './portfolioTakeProfit.js';

const openTrade = (symbol, direction) => ({
  id: `t-${symbol}`,
  symbol,
  direction,
  status: 'OPEN',
  type: 'FUTURES'
});

const position = (symbol, positionAmt, unrealizedProfit, positionSide = 'BOTH') => ({
  symbol,
  positionAmt: String(positionAmt),
  unrealizedProfit: String(unrealizedProfit),
  positionSide
});

test('computeGreenTotal chỉ cộng unrealizedProfit dương của vị thế khớp OPEN row', () => {
  const positions = [
    position('AAVEUSDT', -1, '6.0'),
    position('DOTUSDT', -1, '-3.0'),
    position('BTCUSDT', -1, '0'),
    position('ETHUSDT', -1, '4.5'),
    position('MANUALUSDT', -1, '9.0')
  ];
  const trades = [
    openTrade('AAVEUSDT', 'SHORT'),
    openTrade('DOTUSDT', 'SHORT'),
    openTrade('BTCUSDT', 'SHORT'),
    openTrade('ETHUSDT', 'SHORT')
  ];
  const { totalGreen, candidates } = computeGreenTotal(positions, trades);
  assert.equal(totalGreen, 10.5);
  assert.deepEqual(candidates, [
    { symbol: 'AAVEUSDT', pnl: 6 },
    { symbol: 'ETHUSDT', pnl: 4.5 }
  ]);
});

test('isEngineOwnedPosition khớp direction qua positionSide BOTH (sign positionAmt)', () => {
  const trades = [openTrade('XRPUSDT', 'LONG')];
  assert.equal(isEngineOwnedPosition(position('XRPUSDT', '1.5', '2'), trades), true);
  assert.equal(isEngineOwnedPosition(position('XRPUSDT', '-1.5', '2'), trades), false);
  assert.equal(isEngineOwnedPosition(position('XRPUSDT', '0', '2'), trades), false);
  assert.equal(isEngineOwnedPosition(position('OTHERUSDT', '1.5', '2'), trades), false);
});

test('isEngineOwnedPosition khớp positionSide LONG/SHORT (hedge mode) khi trade direction trùng', () => {
  const trades = [openTrade('LTCUSDT', 'SHORT')];
  assert.equal(
    isEngineOwnedPosition(position('LTCUSDT', '-1', '2', 'SHORT'), trades),
    true
  );
  assert.equal(
    isEngineOwnedPosition(position('LTCUSDT', '-1', '2', 'LONG'), trades),
    false
  );
});

test('computeGreenTotal xử lý input rỗng / không phải array', () => {
  assert.deepEqual(computeGreenTotal([], []), { totalGreen: 0, candidates: [] });
  assert.deepEqual(computeGreenTotal(null, []), { totalGreen: 0, candidates: [] });
  assert.deepEqual(computeGreenTotal([], null), { totalGreen: 0, candidates: [] });
});

test('shouldTriggerPortfolioTp: 9.9/10.1 trigger, dưới 9.9 không', () => {
  assert.equal(PORTFOLIO_TP_THRESHOLD, 10);
  assert.equal(PORTFOLIO_TP_TOLERANCE, 0.1);
  assert.equal(shouldTriggerPortfolioTp(9.9), true);
  assert.equal(shouldTriggerPortfolioTp(10.1), true);
  assert.equal(shouldTriggerPortfolioTp(8), false);
  assert.equal(shouldTriggerPortfolioTp(0), false);
  assert.equal(shouldTriggerPortfolioTp(9.89), false);
  assert.equal(shouldTriggerPortfolioTp(NaN), false);
  assert.equal(shouldTriggerPortfolioTp(10.1, 10), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { selectExecutableSetups } from './setupSelection.js';

const live = overrides => ({
  direction: 'LONG',
  interval: '15m',
  rolloutMode: 'LIVE',
  score: 70,
  symbol: 'BTCUSDT',
  theoreticalRR: 2,
  tradeType: 'FUTURES',
  ...overrides
});

test('a higher-ranked paper setup never suppresses a live setup', () => {
  const paper = live({
    rolloutMode: 'PAPER_ONLY',
    score: 95
  });
  const result = selectExecutableSetups(
    [paper, live({ score: 75 })],
    { allowedIntervals: ['15m'], minScore: 50, now: 1_000_000 }
  );

  assert.equal(result.filterStats.paperOnly, 1);
  assert.equal(result.validSetups.length, 1);
  assert.equal(result.validSetups[0].rolloutMode, 'LIVE');
});

test('a non-executable setup does not reserve its symbol', () => {
  const result = selectExecutableSetups(
    [
      live({ interval: '5m', score: 99 }),
      live({ interval: '15m', score: 80 })
    ],
    { allowedIntervals: ['15m'], minScore: 50, now: 1_000_000 }
  );

  assert.equal(result.filterStats.badInterval, 1);
  assert.equal(result.validSetups.length, 1);
  assert.equal(result.validSetups[0].interval, '15m');
});

test('only the best fully executable setup reserves each symbol', () => {
  const result = selectExecutableSetups(
    [
      live({ score: 75, theoreticalRR: 1.8 }),
      live({ score: 75, theoreticalRR: 2.4 })
    ],
    { allowedIntervals: ['15m'], minScore: 50, now: 1_000_000 }
  );

  assert.equal(result.validSetups.length, 1);
  assert.equal(result.validSetups[0].theoreticalRR, 2.4);
  assert.equal(result.filterStats.duplicate, 1);
});

test('a blocked symbol cannot become executable even with the highest score', () => {
  const result = selectExecutableSetups(
    [
      live({ symbol: '1000XECUSDT', score: 99 }),
      live({ symbol: 'BTCUSDT', score: 70 })
    ],
    { allowedIntervals: ['15m'], minScore: 50, now: 1_000_000 }
  );

  assert.deepEqual(result.validSetups.map(setup => setup.symbol), ['BTCUSDT']);
  assert.equal(result.filterStats.blockedSymbol, 1);
});

test('caps the number of returned setups by maxOpenPositions', () => {
  const symbols = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'ADAUSDT', 'LINKUSDT', 'DOTUSDT', 'AVAXUSDT', 'LTCUSDT'
  ];
  const setups = symbols.map((symbol, index) =>
    live({
      symbol,
      score: 100 - index,
      strategyId: `STRAT_${index}`
    })
  );

  const result = selectExecutableSetups(setups, {
    allowedIntervals: ['15m'],
    minScore: 50,
    now: 1_000_000
  });

  // default maxOpenPositions = 5, distinct strategies => no per-strategy cut
  assert.equal(result.validSetups.length, 5);
  assert.equal(result.filterStats.positionCap, 5);
  assert.deepEqual(
    result.validSetups.map(setup => setup.symbol),
    symbols.slice(0, 5)
  );
  assert.deepEqual(
    result.validSetups.map(setup => setup.score),
    [100, 99, 98, 97, 96]
  );
});

test('caps the number of setups per strategy by maxOpenPerStrategy', () => {
  const symbols = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'ADAUSDT', 'LINKUSDT', 'DOTUSDT', 'AVAXUSDT', 'LTCUSDT'
  ];
  const setups = symbols.map((symbol, index) =>
    live({ symbol, score: 100 - index, strategyId: 'ALPHA' })
  );

  const result = selectExecutableSetups(setups, {
    allowedIntervals: ['15m'],
    minScore: 50,
    now: 1_000_000,
    maxOpenPositions: 10,
    maxOpenPerStrategy: 2
  });

  assert.equal(result.validSetups.length, 2);
  assert.equal(result.filterStats.positionCap, 8);
  assert.deepEqual(
    result.validSetups.map(setup => setup.score),
    [100, 99]
  );
});

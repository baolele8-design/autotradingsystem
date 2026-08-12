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

test('blocks SHORT Tier 2 alt in BTC downtrend and reports avoidable loss', () => {
  const blocked = live({
    symbol: 'ETHUSDT',
    direction: 'SHORT',
    assetTier: 'Tier 2: Liquid Majors',
    btcRegime: 'Downtrend',
    score: 99
  });
  const allowed = live({ symbol: 'BTCUSDT', score: 70 });

  const result = selectExecutableSetups([blocked, allowed], {
    allowedIntervals: ['15m'],
    minScore: 50,
    now: 1_000_000
  });

  assert.deepEqual(result.validSetups.map(setup => setup.symbol), ['BTCUSDT']);
  assert.equal(result.filterStats.btcRegimeBlocked, 1);
  assert.equal(result.btcGateBlocked.length, 1);
  assert.equal(result.btcGateBlocked[0].symbol, 'ETHUSDT');
  assert.ok(result.btcGateBlocked[0].estimatedAvgR < 0);
});

test('LONG in BTC downtrend and SHORT in uptrend both pass the gate', () => {
  const result = selectExecutableSetups(
    [
      live({ symbol: 'ETHUSDT', direction: 'LONG', btcRegime: 'Downtrend' }),
      live({ symbol: 'SOLUSDT', direction: 'SHORT', btcRegime: 'Uptrend' })
    ],
    { allowedIntervals: ['15m'], minScore: 50, now: 1_000_000 }
  );

  assert.equal(result.filterStats.btcRegimeBlocked, 0);
  assert.equal(result.validSetups.length, 2);
});

test('unknown BTC regime passes the gate with a warn flag', () => {
  const result = selectExecutableSetups(
    [live({ symbol: 'ETHUSDT', direction: 'SHORT', btcRegime: null })],
    { allowedIntervals: ['15m'], minScore: 50, now: 1_000_000 }
  );

  assert.equal(result.filterStats.btcRegimeBlocked, 0);
  assert.equal(result.validSetups.length, 1);
});

// F-E1a (2026-08-12): per-interval breakdown in filterStats.byInterval
// mirrors the global counters, keyed by setup.interval.
test('F-E1a filterStats.byInterval breaks counters down per interval', () => {
  const result = selectExecutableSetups(
    [
      live({ interval: '15m', score: 95 }),
      live({ interval: '15m', score: 94, theoreticalRR: 2.5 }),
      live({ interval: '15m', score: 10 }),
      live({ interval: '1h', score: 40 }),
      live({ interval: '4h', score: 80, rolloutMode: 'PAPER_ONLY' })
    ],
    { allowedIntervals: ['15m'], minScore: 50, now: 1_000_000 }
  );

  assert.equal(result.filterStats.duplicate, 1);
  assert.equal(result.filterStats.lowScore, 1);
  assert.equal(result.filterStats.badInterval, 1);
  assert.equal(result.filterStats.paperOnly, 1);
  assert.equal(result.filterStats.passed, 1);

  const fifteen = result.filterStats.byInterval['15m'];
  assert.equal(fifteen.duplicate, 1);
  assert.equal(fifteen.lowScore, 1);
  assert.equal(fifteen.passed, 1);
  assert.equal(fifteen.badInterval, 0);
  assert.equal(fifteen.paperOnly, 0);

  // interval gate (badInterval) runs before the score gate — a 1h setup
  // never reaches lowScore
  const oneHour = result.filterStats.byInterval['1h'];
  assert.equal(oneHour.badInterval, 1);
  assert.equal(oneHour.lowScore, 0);
  assert.equal(oneHour.passed, 0);

  const fourHour = result.filterStats.byInterval['4h'];
  assert.equal(fourHour.paperOnly, 1);
  assert.equal(fourHour.passed, 0);
});

test('F-E1a positionCap lands in the per-interval bucket too', () => {
  const symbols = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'ADAUSDT', 'LINKUSDT', 'DOTUSDT', 'AVAXUSDT', 'LTCUSDT'
  ];
  const setups = symbols.map((symbol, index) =>
    live({ symbol, score: 100 - index, interval: '15m' })
  );

  const result = selectExecutableSetups(setups, {
    allowedIntervals: ['15m'],
    minScore: 50,
    now: 1_000_000,
    maxOpenPositions: 5,
    maxOpenPerStrategy: 10
  });

  assert.equal(result.filterStats.positionCap, 5);
  assert.equal(result.filterStats.byInterval['15m'].positionCap, 5);
  // passed counts setups that cleared the filters (cap runs afterwards)
  assert.equal(result.filterStats.byInterval['15m'].passed, 10);
});

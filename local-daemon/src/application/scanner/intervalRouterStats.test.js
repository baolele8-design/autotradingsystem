import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createIntervalStats,
  accumulateIntervalStats,
  accumulateIntervalNearMiss,
  accumulateIntervalMsbRouting,
  selectLaneDropCounts,
  formatIntervalSummary,
  formatIntervalNearMiss,
  formatIntervalMsbRouting
} from './intervalRouterStats.js';

// F-E1a: interval-level routing measurement. All helpers are pure and
// fail-open: invalid intervals are skipped, never thrown.

test('F-E1a createIntervalStats returns empty per-interval maps', () => {
  const stats = createIntervalStats();
  assert.ok(stats.stats instanceof Map);
  assert.equal(stats.stats.size, 0);
  assert.ok(stats.nearMiss instanceof Map);
  assert.equal(stats.nearMiss.size, 0);
  assert.ok(stats.msb instanceof Map);
  assert.equal(stats.msb.size, 0);
});

test('F-E1a accumulateIntervalStats adds routed/approved/rejected/laneDropped per interval', () => {
  const stats = createIntervalStats();
  accumulateIntervalStats(stats, {
    interval: '15m',
    routedDelta: 1,
    rejectedGates: ['h1', 'h4'],
    minScoreFailed: false
  });
  accumulateIntervalStats(stats, {
    interval: '15m',
    routedDelta: 1,
    approvedDelta: 1
  });
  accumulateIntervalStats(stats, {
    interval: '1h',
    routedDelta: 1,
    rejectedGates: ['h1'],
    minScoreFailed: true,
    laneDropped: 2
  });

  const fifteen = stats.stats.get('15m');
  assert.equal(fifteen.routed, 2);
  assert.equal(fifteen.approved, 1);
  assert.deepEqual(fifteen.rejectedByGate, { h1: 1, h4: 1 });
  assert.equal(fifteen.laneDropped, 0);

  const oneHour = stats.stats.get('1h');
  assert.equal(oneHour.routed, 1);
  assert.deepEqual(oneHour.rejectedByGate, { h1: 1, min_score: 1 });
  assert.equal(oneHour.laneDropped, 2);
});

test('F-E1a accumulateIntervalStats skips invalid intervals without throwing', () => {
  const stats = createIntervalStats();
  assert.doesNotThrow(() => {
    accumulateIntervalStats(stats, { interval: '' });
    accumulateIntervalStats(stats, { interval: null });
    accumulateIntervalStats(stats, { interval: undefined });
    accumulateIntervalStats(stats, {});
  });
  assert.equal(stats.stats.size, 0);
});

test('F-E1a accumulateIntervalNearMiss classifies by first failing layer per interval', () => {
  const stats = createIntervalStats();
  accumulateIntervalNearMiss(stats, {
    interval: '15m',
    diagnostics: { regimePassed: false, triggerPassed: false, confirmationPassed: true, confirmationRequired: 2 }
  });
  accumulateIntervalNearMiss(stats, {
    interval: '15m',
    diagnostics: { regimePassed: true, triggerPassed: false, confirmationPassed: false, confirmationRequired: 2 }
  });
  accumulateIntervalNearMiss(stats, {
    interval: '15m',
    diagnostics: { regimePassed: true, triggerPassed: true, confirmationPassed: false, confirmationRequired: 2 }
  });
  accumulateIntervalNearMiss(stats, {
    interval: '1h',
    diagnostics: { matched: true, regimePassed: true, triggerPassed: true, confirmationPassed: true, confirmationRequired: 2 }
  });

  assert.deepEqual(stats.nearMiss.get('15m'), { REGIME: 1, TRIGGER: 1, CONF: 1 });
  // matched candidate must not be counted
  assert.equal(stats.nearMiss.has('1h'), false);
});

test('F-E1a accumulateIntervalNearMiss skips missing diagnostics and invalid intervals', () => {
  const stats = createIntervalStats();
  assert.doesNotThrow(() => {
    accumulateIntervalNearMiss(stats, { interval: '15m', diagnostics: null });
    accumulateIntervalNearMiss(stats, { interval: '15m' });
    accumulateIntervalNearMiss(stats, { interval: '', diagnostics: { regimePassed: false } });
  });
  assert.equal(stats.nearMiss.size, 0);
});

test('F-E1a selectLaneDropCounts counts per-interval candidates not among winners', () => {
  const candidates = [
    { symbol: 'A', interval: '15m', strategyId: 'X' },
    { symbol: 'B', interval: '15m', strategyId: 'Y' },
    { symbol: 'C', interval: '1h', strategyId: 'X' },
    { symbol: 'D', interval: '1h', strategyId: 'Y' },
    { symbol: 'E', interval: '4h', strategyId: 'X' }
  ];
  const winners = [
    { symbol: 'A', interval: '15m', strategyId: 'X' },
    { symbol: 'C', interval: '1h', strategyId: 'X' }
  ];
  assert.deepEqual(selectLaneDropCounts(candidates, winners), {
    '15m': 1,
    '1h': 1,
    '4h': 1
  });
});

test('F-E1a selectLaneDropCounts returns empty map for no drops and tolerates invalid input', () => {
  assert.deepEqual(selectLaneDropCounts([], []), {});
  assert.deepEqual(selectLaneDropCounts(null, null), {});
  const candidates = [{ symbol: 'A', interval: '15m' }];
  assert.deepEqual(selectLaneDropCounts(candidates, candidates), {});
});

test('F-E1a formatIntervalSummary renders per-interval line with minRouted filter', () => {
  const stats = createIntervalStats();
  accumulateIntervalStats(stats, { interval: '15m', routedDelta: 5, approvedDelta: 2, rejectedGates: ['h1', 'h4'] });
  accumulateIntervalStats(stats, { interval: '1h', routedDelta: 3, approvedDelta: 3 });
  accumulateIntervalStats(stats, { interval: '4h', routedDelta: 1, approvedDelta: 0, laneDropped: 1 });

  const line = formatIntervalSummary(stats);
  assert.equal(
    line,
    '[INTERVAL ROUTER] 15m: routed 5 approved 2 rejected {h1:1,h4:1} laneDropped 0 | 1h: routed 3 approved 3 laneDropped 0 | 4h: routed 1 approved 0 laneDropped 1'
  );
  // minRouted hides quiet intervals
  const filtered = formatIntervalSummary(stats, { minRouted: 2 });
  assert.equal(filtered.includes('4h:'), false);
  assert.equal(filtered.includes('15m:'), true);
});

test('F-E1a formatIntervalSummary returns null when no interval reaches minRouted', () => {
  const stats = createIntervalStats();
  accumulateIntervalStats(stats, { interval: '15m', routedDelta: 1 });
  assert.equal(formatIntervalSummary(stats, { minRouted: 2 }), null);
  assert.equal(formatIntervalSummary(stats), '[INTERVAL ROUTER] 15m: routed 1 approved 0 laneDropped 0');
});

test('F-E1a formatIntervalNearMiss renders per-interval near-miss with minCount filter', () => {
  const stats = createIntervalStats();
  for (let i = 0; i < 4; i++) {
    accumulateIntervalNearMiss(stats, {
      interval: '15m',
      diagnostics: { regimePassed: true, triggerPassed: false, confirmationPassed: false, confirmationRequired: 2 }
    });
  }
  accumulateIntervalNearMiss(stats, {
    interval: '1h',
    diagnostics: { regimePassed: false, triggerPassed: false, confirmationPassed: false, confirmationRequired: 2 }
  });
  accumulateIntervalNearMiss(stats, {
    interval: '1h',
    diagnostics: { regimePassed: false, triggerPassed: false, confirmationPassed: false, confirmationRequired: 2 }
  });

  assert.equal(
    formatIntervalNearMiss(stats, { minCount: 2 }),
    '[INTERVAL NEAR-MISS] 15m: REGIME 0 TRIGGER 4 CONF 0 | 1h: REGIME 2 TRIGGER 0 CONF 0'
  );
  // default minCount 3 hides the quiet 1h interval
  assert.equal(formatIntervalNearMiss(stats), '[INTERVAL NEAR-MISS] 15m: REGIME 0 TRIGGER 4 CONF 0');
  assert.equal(formatIntervalNearMiss(stats, { minCount: 99 }), null);
});

test('F-E1a accumulateIntervalMsbRouting counts aligned/misaligned/sfpAtEntry per interval', () => {
  const stats = createIntervalStats();
  accumulateIntervalMsbRouting(stats, { interval: '15m', aligned: true, misaligned: false, sfpAtEntry: true });
  accumulateIntervalMsbRouting(stats, { interval: '15m', aligned: false, misaligned: true, sfpAtEntry: false });
  accumulateIntervalMsbRouting(stats, { interval: '1h', aligned: true, misaligned: false, sfpAtEntry: false });

  assert.deepEqual(stats.msb.get('15m'), { aligned: 1, misaligned: 1, sfpAtEntry: 1 });
  assert.deepEqual(stats.msb.get('1h'), { aligned: 1, misaligned: 0, sfpAtEntry: 0 });
  // invalid interval skipped
  assert.doesNotThrow(() => accumulateIntervalMsbRouting(stats, { interval: '' }));
  assert.equal(stats.msb.size, 2);
  assert.equal(
    formatIntervalMsbRouting(stats),
    '[MSB ROUTING] 15m: aligned 1 misaligned 1 sfpAtEntry 1 | 1h: aligned 1 misaligned 0 sfpAtEntry 0'
  );
});

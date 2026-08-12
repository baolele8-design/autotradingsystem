// F-E1a (2026-08-12): interval-level routing measurement for the matrix
// scanner. Shadow/payload-only: these counters feed the `[INTERVAL ROUTER]`,
// `[INTERVAL NEAR-MISS]` and `[MSB ROUTING]` log lines and never change the
// live route/score/gate decisions. All helpers are pure and fail-open —
// invalid intervals or missing inputs are skipped, never thrown.
//
// Near-miss classification reuses classifyNearMiss from matrixScannerService
// (first failing layer wins: REGIME → TRIGGER → CONF).

const VALID_INTERVALS = new Set(['15m', '1h', '4h', '1d']);

// Stable render order for summaries: 15m first, then ascending frame size.
const INTERVAL_RANK = new Map([
  ['5m', 0],
  ['15m', 1],
  ['1h', 2],
  ['4h', 3],
  ['1d', 4],
  ['1w', 5]
]);

const isInterval = (interval) =>
  typeof interval === 'string' && VALID_INTERVALS.has(interval);

const orderedEntries = (map) =>
  [...(map?.entries?.() || [])].sort(
    (left, right) =>
      (INTERVAL_RANK.get(left[0]) ?? 99) - (INTERVAL_RANK.get(right[0]) ?? 99)
  );

const emptyInterval = () => ({
  routed: 0,
  approved: 0,
  rejectedByGate: {},
  laneDropped: 0
});

export const createIntervalStats = () => ({
  stats: new Map(),
  nearMiss: new Map(),
  msb: new Map()
});

export const accumulateIntervalStats = (
  stats,
  { interval, routedDelta = 0, approvedDelta = 0, rejectedGates = [], minScoreFailed = false, laneDropped = 0 } = {}
) => {
  if (!stats?.stats || !isInterval(interval)) return;
  let entry = stats.stats.get(interval);
  if (!entry) {
    entry = emptyInterval();
    stats.stats.set(interval, entry);
  }
  entry.routed += Number(routedDelta) || 0;
  entry.approved += Number(approvedDelta) || 0;
  for (const gateId of rejectedGates || []) {
    if (typeof gateId === 'string' && gateId) {
      entry.rejectedByGate[gateId] = (entry.rejectedByGate[gateId] || 0) + 1;
    }
  }
  if (minScoreFailed) {
    entry.rejectedByGate.min_score = (entry.rejectedByGate.min_score || 0) + 1;
  }
  entry.laneDropped += Number(laneDropped) || 0;
};

export const accumulateIntervalNearMiss = (
  stats,
  { interval, diagnostics } = {}
) => {
  if (!stats?.nearMiss || !isInterval(interval)) return;
  if (!diagnostics || typeof diagnostics !== 'object') return;
  // Matched candidates are not near-misses; classifyNearMiss is reused
  // verbatim (matrixScannerService.js:51-61).
  if (diagnostics.matched) return;
  const { reason } = classifyNearMissLocal(diagnostics);
  let entry = stats.nearMiss.get(interval);
  if (!entry) {
    entry = { REGIME: 0, TRIGGER: 0, CONF: 0 };
    stats.nearMiss.set(interval, entry);
  }
  entry[reason] += 1;
};

// Local mirror of matrixScannerService.classifyNearMiss to avoid a circular
// import (the scanner imports this module). Same first-failure-layer rule.
const classifyNearMissLocal = (diagnostics) => {
  if (!diagnostics.regimePassed) return { reason: 'REGIME' };
  if (!diagnostics.triggerPassed) return { reason: 'TRIGGER' };
  return { reason: 'CONF' };
};

export const accumulateIntervalMsbRouting = (
  stats,
  { interval, aligned = false, misaligned = false, sfpAtEntry = false } = {}
) => {
  if (!stats?.msb || !isInterval(interval)) return;
  let entry = stats.msb.get(interval);
  if (!entry) {
    entry = { aligned: 0, misaligned: 0, sfpAtEntry: 0 };
    stats.msb.set(interval, entry);
  }
  entry.aligned += aligned ? 1 : 0;
  entry.misaligned += misaligned ? 1 : 0;
  entry.sfpAtEntry += sfpAtEntry ? 1 : 0;
};

export const selectLaneDropCounts = (candidates, winners) => {
  const winnerSet = new Set(
    (winners || []).map(candidate => `${candidate?.symbol}|${candidate?.interval}`)
  );
  const dropped = {};
  for (const candidate of candidates || []) {
    const interval = candidate?.interval;
    if (!isInterval(interval)) continue;
    if (winnerSet.has(`${candidate.symbol}|${interval}`)) continue;
    dropped[interval] = (dropped[interval] || 0) + 1;
  }
  return dropped;
};

export const formatIntervalSummary = (stats, { minRouted = 0 } = {}) => {
  const parts = [];
  for (const [interval, entry] of orderedEntries(stats?.stats)) {
    if (entry.routed < minRouted) continue;
    const rejectedKeys = Object.keys(entry.rejectedByGate || {});
    const rejectedText = rejectedKeys.length > 0
      ? ` rejected {${rejectedKeys
          .sort()
          .map(key => `${key}:${entry.rejectedByGate[key]}`)
          .join(',')}}`
      : '';
    parts.push(
      `${interval}: routed ${entry.routed} approved ${entry.approved}` +
      `${rejectedText} laneDropped ${entry.laneDropped}`
    );
  }
  if (parts.length === 0) return null;
  return `[INTERVAL ROUTER] ${parts.join(' | ')}`;
};

export const formatIntervalNearMiss = (stats, { minCount = 3 } = {}) => {
  const parts = [];
  for (const [interval, entry] of orderedEntries(stats?.nearMiss)) {
    const total = entry.REGIME + entry.TRIGGER + entry.CONF;
    if (total < minCount) continue;
    parts.push(
      `${interval}: REGIME ${entry.REGIME} TRIGGER ${entry.TRIGGER} CONF ${entry.CONF}`
    );
  }
  if (parts.length === 0) return null;
  return `[INTERVAL NEAR-MISS] ${parts.join(' | ')}`;
};

export const formatIntervalMsbRouting = (stats, { minCount = 1 } = {}) => {
  const parts = [];
  for (const [interval, entry] of orderedEntries(stats?.msb)) {
    const total = entry.aligned + entry.misaligned;
    if (total < minCount) continue;
    parts.push(
      `${interval}: aligned ${entry.aligned} misaligned ${entry.misaligned} sfpAtEntry ${entry.sfpAtEntry}`
    );
  }
  if (parts.length === 0) return null;
  return `[MSB ROUTING] ${parts.join(' | ')}`;
};

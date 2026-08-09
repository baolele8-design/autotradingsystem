// FILE: local-daemon/src/application/strategyHealth/strategyWatchdog.js
//
// R3 WATCHDOG — pure stale-strategy classification (spec 10_reachability_fix_spec.md §3).
// No I/O, no timers, no state: daemonScheduler owns the 5-min interval and the
// in-memory fire-state Map; this module only classifies + formats, so it is
// fully deterministic and unit-testable (pattern: entryRatePolicy).
//
// Cadence reference (spec §3.1): scanner runs every 60s (matrixScannerService.js:1260),
// so 720 cycles = 12h without a fire. Trade holding cycles in the sample:
// mean 12.3, max 271 — a 12h no-fire window is a reliable signal.

export const SCANNER_CYCLE_MS = 60_000;
export const DEFAULT_STALE_AFTER_CYCLES = 720; // ~12h at 60s cadence

/**
 * Classify strategies by how long since they last fired.
 *
 * inputs: strategies = [{ strategyId, lastFiredAt }] ; now = Date.now()
 * output: [{ strategyId, lastFiredAt, staleCycles, status }] for every
 *         strategy that is NOT 'ACTIVE' — status:
 *           'NEVER_FIRED' — lastFiredAt is null/0/negative (never recorded)
 *           'STALE'       — staleCycles >= staleAfterCycles
 *         (ACTIVE entries are filtered out of the result)
 *
 * Future lastFiredAt (clock skew) clamps to 0 stale cycles => ACTIVE.
 */
export function findStaleStrategies({
  strategies = [],
  now,
  staleAfterCycles = DEFAULT_STALE_AFTER_CYCLES,
  cycleMs = SCANNER_CYCLE_MS
}) {
  const cycle = cycleMs > 0 ? cycleMs : SCANNER_CYCLE_MS;
  return strategies
    .map(s => {
      const neverFired = s.lastFiredAt == null || s.lastFiredAt <= 0;
      const staleCycles = neverFired
        ? Infinity
        : Math.max(0, Math.floor((now - s.lastFiredAt) / cycle));
      const status = neverFired
        ? 'NEVER_FIRED'
        : staleCycles >= staleAfterCycles
          ? 'STALE'
          : 'ACTIVE';
      return {
        strategyId: s.strategyId,
        lastFiredAt: neverFired ? null : s.lastFiredAt,
        staleCycles,
        status
      };
    })
    .filter(s => s.status !== 'ACTIVE');
}

/**
 * One-line stale summary, e.g.:
 *   [STRATEGY STALE] CVD_STRUCTURE_DIVERGENCE (NEVER_FIRED), PASSIVE_ABSORPTION_REVERSAL (STALE)
 * Empty/absent list => "[STRATEGY STALE] none".
 */
export function logStaleSummary(staleList = []) {
  if (!Array.isArray(staleList) || staleList.length === 0) {
    return '[STRATEGY STALE] none';
  }
  const parts = staleList.map(s => `${s.strategyId} (${s.status})`);
  return `[STRATEGY STALE] ${parts.join(', ')}`;
}

// FILE: local-daemon/src/domain/execution/entryRatePolicy.js
//
// Pure decision functions for entry rate limiting (F2 / Pareto P2).
// Extracted from autoBot.js so the concurrency/cadence policy is unit-testable
// without importing autoBot.js (which has import side effects: Supabase
// client creation and the auto-start WebSocket connection).

/**
 * True when a new entry batch must be skipped because the most recent batch
 * is younger than `minBatchIntervalMs`.
 */
export function isBatchCooldownActive(lastEntryBatchAt, now, minBatchIntervalMs) {
  return (
    lastEntryBatchAt > 0 &&
    now - lastEntryBatchAt < minBatchIntervalMs
  );
}

/**
 * Caps the ranked executable setups to the number of open positions allowed
 * in one batch: min(freeSlots, maxOpenPositions), clamped to [0, list.length].
 * Returns the sliced list (caller keeps the original intact).
 */
export function capTargetsByOpenPositions(validSetups, freeSlots, maxOpenPositions) {
  const maxOpen = Math.max(0, Math.min(
    Number.isFinite(freeSlots) ? Math.floor(freeSlots) : 0,
    Number.isFinite(maxOpenPositions) ? Math.floor(maxOpenPositions) : 0
  ));
  return Array.isArray(validSetups) ? validSetups.slice(0, maxOpen) : [];
}

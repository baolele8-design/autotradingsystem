import {
  LIQUIDATION_COMPLETENESS,
  LIQUIDATION_NOTIONAL_UNIT,
  LIQUIDATION_SOURCE
} from '../../../../src/domain/analytics/quant/liquidityMetadata.js';

export const LIQUIDATION_WINDOW_MS = 15 * 60 * 1000;

const coverageByCache = new WeakMap();

function normalizeWindowMs(windowMs) {
  const numeric = Number(windowMs);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric
    : LIQUIDATION_WINDOW_MS;
}

function normalizeEvent(event, now) {
  const timestamp = Number(event?.timestamp);
  const notionalUsd = Number(event?.notionalUsd);
  const side = event?.side;

  if (
    !Number.isFinite(notionalUsd) ||
    notionalUsd <= 0 ||
    (side !== 'BUY' && side !== 'SELL')
  ) {
    return null;
  }

  const normalizedTimestamp =
    Number.isFinite(timestamp) && timestamp > 0
      ? Math.min(timestamp, now)
      : now;
  const suppliedId =
    typeof event?.id === 'string'
      ? event.id.trim()
      : '';

  return {
    id:
      suppliedId ||
      `${normalizedTimestamp}:${side}:${notionalUsd}`,
    notionalUsd,
    side,
    timestamp: normalizedTimestamp
  };
}

function pruneEvents(events, cutoff) {
  return (events || []).filter(event => event.timestamp >= cutoff);
}

function emptyCoverageState() {
  return {
    connected: false,
    coverageStartedAt: 0,
    generation: 0,
    lastDisconnectedAt: 0,
    lastStreamEventAt: 0,
    subscriptionConfirmedAt: 0
  };
}

function getCoverageState(cache) {
  return (
    (cache instanceof Map && coverageByCache.get(cache)) ||
    emptyCoverageState()
  );
}

export function getLiquidationCoverage(
  cache,
  {
    now = Date.now(),
    windowMs = LIQUIDATION_WINDOW_MS
  } = {}
) {
  const safeNow = Number.isFinite(Number(now))
    ? Number(now)
    : Date.now();
  const safeWindowMs = normalizeWindowMs(windowMs);
  const state = getCoverageState(cache);
  const coverageMs =
    state.connected && state.coverageStartedAt > 0
      ? Math.max(0, safeNow - state.coverageStartedAt)
      : 0;
  const coverageReady =
    state.connected && coverageMs >= safeWindowMs;

  return {
    completeness: LIQUIDATION_COMPLETENESS,
    coverageGeneration: state.generation,
    coverageMs,
    coverageReady,
    coverageStartedAt: state.coverageStartedAt,
    lastDisconnectedAt: state.lastDisconnectedAt,
    notionalUnit: LIQUIDATION_NOTIONAL_UNIT,
    observedLowerBound: true,
    source: LIQUIDATION_SOURCE,
    streamConnected: state.connected,
    streamLastEventAt: state.lastStreamEventAt,
    subscriptionConfirmedAt: state.subscriptionConfirmedAt,
    warmupRemainingMs: coverageReady
      ? 0
      : Math.max(0, safeWindowMs - coverageMs)
  };
}

export function markLiquidationStreamConnected(
  cache,
  { now = Date.now() } = {}
) {
  if (!(cache instanceof Map)) return null;
  const safeNow = Number.isFinite(Number(now))
    ? Number(now)
    : Date.now();
  const current = getCoverageState(cache);
  if (current.connected) {
    return getLiquidationCoverage(cache, { now: safeNow });
  }

  // A reconnect creates a new observation epoch. Never mix events across a
  // connection gap because the snapshot stream cannot backfill missed orders.
  cache.clear();
  coverageByCache.set(cache, {
    connected: true,
    coverageStartedAt: safeNow,
    generation: current.generation + 1,
    lastDisconnectedAt: current.lastDisconnectedAt,
    lastStreamEventAt: 0,
    subscriptionConfirmedAt: safeNow
  });
  return getLiquidationCoverage(cache, { now: safeNow });
}

export function markLiquidationStreamDisconnected(
  cache,
  { now = Date.now() } = {}
) {
  if (!(cache instanceof Map)) return null;
  const safeNow = Number.isFinite(Number(now))
    ? Number(now)
    : Date.now();
  const current = getCoverageState(cache);

  cache.clear();
  coverageByCache.set(cache, {
    connected: false,
    coverageStartedAt: 0,
    generation: current.generation + 1,
    lastDisconnectedAt: safeNow,
    lastStreamEventAt: 0,
    subscriptionConfirmedAt: 0
  });
  return getLiquidationCoverage(cache, { now: safeNow });
}

function summarize(events, windowMs, snapshotAt, coverage) {
  let longs = 0;
  let shorts = 0;

  for (const event of events) {
    // A forced SELL closes a long; a forced BUY closes a short.
    if (event.side === 'SELL') longs += event.notionalUsd;
    if (event.side === 'BUY') shorts += event.notionalUsd;
  }

  return {
    ...coverage,
    eventCount: events.length,
    events,
    lastClear: snapshotAt,
    longs,
    shorts,
    snapshotAt,
    updatedAt: events.reduce(
      (latest, event) => Math.max(latest, event.timestamp),
      0
    ),
    windowMs
  };
}

export function recordLiquidation(
  cache,
  symbol,
  event,
  {
    now = Date.now(),
    windowMs = LIQUIDATION_WINDOW_MS
  } = {}
) {
  if (!(cache instanceof Map) || !symbol) return null;
  const safeNow = Number.isFinite(Number(now))
    ? Number(now)
    : Date.now();
  const safeWindowMs = normalizeWindowMs(windowMs);
  const normalized = normalizeEvent(event, safeNow);
  if (!normalized) return null;

  const coverageState = getCoverageState(cache);
  if (coverageState.connected) {
    coverageByCache.set(cache, {
      ...coverageState,
      lastStreamEventAt: safeNow
    });
  }

  const cacheKey = String(symbol).toUpperCase();
  const current = cache.get(cacheKey);
  const activeEvents = pruneEvents(
    current?.events,
    safeNow - safeWindowMs
  );
  const isDuplicate = activeEvents.some(
    item => item.id === normalized.id
  );
  const events = isDuplicate
    ? activeEvents
    : [...activeEvents, normalized];
  const snapshot = summarize(
    events,
    safeWindowMs,
    safeNow,
    getLiquidationCoverage(cache, {
      now: safeNow,
      windowMs: safeWindowMs
    })
  );
  cache.set(cacheKey, snapshot);
  return snapshot;
}

export function readLiquidationWindow(
  cache,
  symbol,
  {
    now = Date.now(),
    windowMs = LIQUIDATION_WINDOW_MS
  } = {}
) {
  const safeNow = Number.isFinite(Number(now))
    ? Number(now)
    : Date.now();
  const safeWindowMs = normalizeWindowMs(windowMs);
  const coverage = getLiquidationCoverage(cache, {
    now: safeNow,
    windowMs: safeWindowMs
  });
  if (!(cache instanceof Map) || !symbol) {
    return summarize([], safeWindowMs, safeNow, coverage);
  }

  const cacheKey = String(symbol).toUpperCase();
  const current = cache.get(cacheKey);
  if (!current) {
    return summarize([], safeWindowMs, safeNow, coverage);
  }

  const events = pruneEvents(
    current.events,
    safeNow - safeWindowMs
  );
  const snapshot = summarize(
    events,
    safeWindowMs,
    safeNow,
    coverage
  );

  if (events.length === 0) cache.delete(cacheKey);
  else cache.set(cacheKey, snapshot);

  return snapshot;
}

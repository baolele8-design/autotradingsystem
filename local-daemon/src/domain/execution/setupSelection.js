import {
  isNewEntrySymbolAllowed
} from '../../../../src/domain/trading/symbolEntryPolicy.js';
import { evaluateBtcEntryGate } from './btcEntryGate.js';

const numeric = value => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const rankSetups = (left, right) => {
  const scoreDelta = numeric(right?.score) - numeric(left?.score);
  if (scoreDelta !== 0) return scoreDelta;
  return numeric(right?.theoreticalRR) - numeric(left?.theoreticalRR);
};

export function selectExecutableSetups(
  setups,
  {
    actionCooldowns = new Map(),
    allowedIntervals = [],
    cooldownMs = 300_000,
    minScore = 50,
    now = Date.now(),
    occupiedSymbols = [],
    maxOpenPositions = 5,
    maxOpenPerStrategy = 2
  } = {}
) {
  const filterStats = {
    badInterval: 0,
    blockedSymbol: 0,
    btcRegimeBlocked: 0,
    cooldown: 0,
    duplicate: 0,
    invalid: 0,
    lowScore: 0,
    notFutures: 0,
    paperOnly: 0,
    passed: 0,
    positionCap: 0,
    // F-E1a (2026-08-12): per-interval breakdown (shadow measurement only)
    // — keys mirror the global counters above, keyed by setup.interval.
    byInterval: {}
  };
  // F-E1a: increment both the global counter and the per-interval bucket.
  const intervalKeys = [
    'badInterval', 'blockedSymbol', 'btcRegimeBlocked', 'cooldown',
    'duplicate', 'invalid', 'lowScore', 'notFutures', 'paperOnly',
    'passed', 'positionCap'
  ];
  const bump = (key, setup) => {
    filterStats[key] += 1;
    const interval = String(setup?.interval || 'unknown');
    let bucket = filterStats.byInterval[interval];
    if (!bucket) {
      bucket = {};
      for (const bucketKey of intervalKeys) bucket[bucketKey] = 0;
      filterStats.byInterval[interval] = bucket;
    }
    bucket[key] += 1;
  };
  const validSetups = [];
  const btcGateBlocked = [];
  const alreadyOccupied = new Set(occupiedSymbols);
  const selectedSymbols = new Set();
  const rankedSetups = [...(Array.isArray(setups) ? setups : [])]
    .sort(rankSetups);

  for (const setup of rankedSetups) {
    const symbol = String(setup?.symbol || '').trim().toUpperCase();
    if (!symbol) {
      bump('invalid', setup);
      continue;
    }
    if (!isNewEntrySymbolAllowed(symbol)) {
      bump('blockedSymbol', setup);
      continue;
    }
    if (
      setup.executionMode === 'PAPER_ONLY' ||
      setup.rolloutMode === 'PAPER_ONLY'
    ) {
      bump('paperOnly', setup);
      continue;
    }
    const btcGate = evaluateBtcEntryGate({
      direction: setup.direction,
      assetTier: setup.assetTier,
      btcRegime: setup.btcRegime,
      symbol
    });
    if (btcGate.blocked) {
      bump('btcRegimeBlocked', setup);
      btcGateBlocked.push({ ...setup, symbol, ...btcGate });
      continue;
    }
    if (!allowedIntervals.includes(setup.interval)) {
      bump('badInterval', setup);
      continue;
    }
    if (alreadyOccupied.has(symbol)) {
      bump('duplicate', setup);
      continue;
    }
    if (numeric(setup.score) < minScore) {
      bump('lowScore', setup);
      continue;
    }
    if (setup.tradeType !== 'FUTURES') {
      bump('notFutures', setup);
      continue;
    }

    const lastFiredTime = numeric(actionCooldowns.get(symbol));
    if (lastFiredTime > 0 && now - lastFiredTime < cooldownMs) {
      bump('cooldown', setup);
      continue;
    }
    if (selectedSymbols.has(symbol)) {
      bump('duplicate', setup);
      continue;
    }

    selectedSymbols.add(symbol);
    validSetups.push({ ...setup, symbol });
    bump('passed', setup);
  }

  // CẮT CONCURRENCY: validSetups đã xếp hạng theo score giảm dần (rankedSetups
  // sort trước vòng lọc). Giới hạn số vị thế mở tối đa tổng và tối đa mỗi strategy.
  const cappedSetups = [];
  const strategyCounts = new Map();
  for (const setup of validSetups) {
    if (cappedSetups.length >= maxOpenPositions) {
      bump('positionCap', setup);
      continue;
    }
    const strategyKey = String(setup.strategyId || 'DEFAULT');
    const strategyCount = strategyCounts.get(strategyKey) || 0;
    if (strategyCount >= maxOpenPerStrategy) {
      bump('positionCap', setup);
      continue;
    }
    strategyCounts.set(strategyKey, strategyCount + 1);
    cappedSetups.push(setup);
  }

  return { filterStats, validSetups: cappedSetups, btcGateBlocked };
}

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
    positionCap: 0
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
      filterStats.invalid += 1;
      continue;
    }
    if (!isNewEntrySymbolAllowed(symbol)) {
      filterStats.blockedSymbol += 1;
      continue;
    }
    if (
      setup.executionMode === 'PAPER_ONLY' ||
      setup.rolloutMode === 'PAPER_ONLY'
    ) {
      filterStats.paperOnly += 1;
      continue;
    }
    const btcGate = evaluateBtcEntryGate({
      direction: setup.direction,
      assetTier: setup.assetTier,
      btcRegime: setup.btcRegime,
      symbol
    });
    if (btcGate.blocked) {
      filterStats.btcRegimeBlocked += 1;
      btcGateBlocked.push({ ...setup, symbol, ...btcGate });
      continue;
    }
    if (!allowedIntervals.includes(setup.interval)) {
      filterStats.badInterval += 1;
      continue;
    }
    if (alreadyOccupied.has(symbol)) {
      filterStats.duplicate += 1;
      continue;
    }
    if (numeric(setup.score) < minScore) {
      filterStats.lowScore += 1;
      continue;
    }
    if (setup.tradeType !== 'FUTURES') {
      filterStats.notFutures += 1;
      continue;
    }

    const lastFiredTime = numeric(actionCooldowns.get(symbol));
    if (lastFiredTime > 0 && now - lastFiredTime < cooldownMs) {
      filterStats.cooldown += 1;
      continue;
    }
    if (selectedSymbols.has(symbol)) {
      filterStats.duplicate += 1;
      continue;
    }

    selectedSymbols.add(symbol);
    validSetups.push({ ...setup, symbol });
    filterStats.passed += 1;
  }

  // CẮT CONCURRENCY: validSetups đã xếp hạng theo score giảm dần (rankedSetups
  // sort trước vòng lọc). Giới hạn số vị thế mở tối đa tổng và tối đa mỗi strategy.
  const cappedSetups = [];
  const strategyCounts = new Map();
  for (const setup of validSetups) {
    if (cappedSetups.length >= maxOpenPositions) {
      filterStats.positionCap += 1;
      continue;
    }
    const strategyKey = String(setup.strategyId || 'DEFAULT');
    const strategyCount = strategyCounts.get(strategyKey) || 0;
    if (strategyCount >= maxOpenPerStrategy) {
      filterStats.positionCap += 1;
      continue;
    }
    strategyCounts.set(strategyKey, strategyCount + 1);
    cappedSetups.push(setup);
  }

  return { filterStats, validSetups: cappedSetups, btcGateBlocked };
}

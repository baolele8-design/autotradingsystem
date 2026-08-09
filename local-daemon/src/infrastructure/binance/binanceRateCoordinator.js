const DEFAULT_LIMITS = Object.freeze({
  orderCount10s: 300,
  orderCount1m: 1_200,
  requestWeight1m: 2_400
});

export const BINANCE_RATE_PRIORITY = Object.freeze({
  RECONCILIATION: 'reconciliation',
  MARKET_DATA: 'market-data',
  ACCOUNT: 'account',
  PROTECTION: 'protection',
  EXECUTION: 'execution'
});

const DEFAULT_BUDGET_RATIOS = Object.freeze({
  [BINANCE_RATE_PRIORITY.MARKET_DATA]: 0.65,
  [BINANCE_RATE_PRIORITY.ACCOUNT]: 0.75,
  [BINANCE_RATE_PRIORITY.EXECUTION]: 0.85,
  [BINANCE_RATE_PRIORITY.PROTECTION]: 0.95
});

const finiteNonNegative = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const readHeader = (headers, name) => {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === target
  );
  return entry?.[1] ?? null;
};

const windowBucket = (now, durationMs) => Math.floor(now / durationMs);
const utilization = (used, limit) => limit > 0 ? used / limit : 1;

export function createBinanceRateCoordinator({
  budgetRatios = DEFAULT_BUDGET_RATIOS,
  limits = DEFAULT_LIMITS,
  now = Date.now,
  requireInitialObservation = false
} = {}) {
  const configuredLimits = {
    orderCount10s: finiteNonNegative(
      limits.orderCount10s,
      DEFAULT_LIMITS.orderCount10s
    ),
    orderCount1m: finiteNonNegative(
      limits.orderCount1m,
      DEFAULT_LIMITS.orderCount1m
    ),
    requestWeight1m: finiteNonNegative(
      limits.requestWeight1m,
      DEFAULT_LIMITS.requestWeight1m
    )
  };
  const windows = {
    orderCount10s: { bucket: null, durationMs: 10_000, used: 0 },
    orderCount1m: { bucket: null, durationMs: 60_000, used: 0 },
    requestWeight1m: { bucket: null, durationMs: 60_000, used: 0 }
  };
  const deniedByPriority = new Map();
  let blockedUntil = 0;
  let initialObservationReady = !requireInitialObservation;
  let reconciliationReservedAt = 0;
  let lastObservedAt = 0;
  let lastLimitStatus = null;

  function refreshWindow(window, currentTime) {
    const bucket = windowBucket(currentTime, window.durationMs);
    if (window.bucket !== bucket) {
      window.bucket = bucket;
      window.used = 0;
    }
  }

  function refreshAll(currentTime) {
    Object.values(windows).forEach(window =>
      refreshWindow(window, currentTime)
    );
  }

  function getRatio(priority) {
    const ratio = Number(budgetRatios[priority]);
    return Number.isFinite(ratio) && ratio > 0 && ratio <= 1
      ? ratio
      : DEFAULT_BUDGET_RATIOS[BINANCE_RATE_PRIORITY.MARKET_DATA];
  }

  function deny(priority, reason, currentTime) {
    deniedByPriority.set(
      priority,
      (deniedByPriority.get(priority) || 0) + 1
    );
    const retryAfterMs = blockedUntil > currentTime
      ? blockedUntil - currentTime
      : Math.max(
          1,
          60_000 - (currentTime % 60_000)
        );
    return { allowed: false, reason, retryAfterMs };
  }

  function reserve({
    orderCount = 0,
    priority = BINANCE_RATE_PRIORITY.MARKET_DATA,
    requestWeight = 1
  } = {}) {
    const currentTime = now();
    refreshAll(currentTime);
    if (blockedUntil > currentTime) {
      return deny(priority, 'BINANCE_BACKOFF_ACTIVE', currentTime);
    }

    if (!initialObservationReady) {
      const reconciliationExpired =
        currentTime - reconciliationReservedAt >= 15_000;
      const canReconcile =
        priority === BINANCE_RATE_PRIORITY.RECONCILIATION &&
        orderCount === 0 &&
        requestWeight <= 1 &&
        (reconciliationReservedAt === 0 || reconciliationExpired);
      if (!canReconcile) {
        return deny(priority, 'RATE_STATE_WARMING', currentTime);
      }
      reconciliationReservedAt = currentTime;
      windows.requestWeight1m.used += 1;
      return {
        allowed: true,
        orderCount: 0,
        priority,
        requestWeight: 1
      };
    }

    const ratio = getRatio(priority);
    const weightCost = Math.max(0, Math.ceil(finiteNonNegative(requestWeight, 1)));
    const orderCost = Math.max(0, Math.ceil(finiteNonNegative(orderCount, 0)));
    const limitsForPriority = {
      orderCount10s: Math.floor(configuredLimits.orderCount10s * ratio),
      orderCount1m: Math.floor(configuredLimits.orderCount1m * ratio),
      requestWeight1m: Math.floor(configuredLimits.requestWeight1m * ratio)
    };

    if (
      windows.requestWeight1m.used + weightCost >
      limitsForPriority.requestWeight1m
    ) {
      return deny(priority, 'REQUEST_WEIGHT_BUDGET_EXHAUSTED', currentTime);
    }
    if (
      orderCost > 0 &&
      (
        windows.orderCount10s.used + orderCost > limitsForPriority.orderCount10s ||
        windows.orderCount1m.used + orderCost > limitsForPriority.orderCount1m
      )
    ) {
      return deny(priority, 'ORDER_COUNT_BUDGET_EXHAUSTED', currentTime);
    }

    windows.requestWeight1m.used += weightCost;
    windows.orderCount10s.used += orderCost;
    windows.orderCount1m.used += orderCost;
    return {
      allowed: true,
      orderCount: orderCost,
      priority,
      requestWeight: weightCost
    };
  }

  function observeResponse({ headers, status } = {}) {
    const currentTime = now();
    refreshAll(currentTime);
    const observations = {
      orderCount10s: finiteNonNegative(
        readHeader(headers, 'x-mbx-order-count-10s'),
        -1
      ),
      orderCount1m: finiteNonNegative(
        readHeader(headers, 'x-mbx-order-count-1m'),
        -1
      ),
      requestWeight1m: finiteNonNegative(
        readHeader(headers, 'x-mbx-used-weight-1m'),
        -1
      )
    };
    for (const [key, value] of Object.entries(observations)) {
      if (value >= 0) windows[key].used = Math.max(windows[key].used, value);
    }
    lastObservedAt = currentTime;
    lastLimitStatus = Number(status) || null;
    if (!initialObservationReady && reconciliationReservedAt > 0) {
      initialObservationReady = true;
    }

    if ([418, 429].includes(Number(status))) {
      const retryAfterSeconds = Number.parseInt(
        readHeader(headers, 'retry-after') || '',
        10
      );
      const fallbackMs = Number(status) === 418 ? 5 * 60_000 : 60_000;
      blockedUntil = Math.max(
        blockedUntil,
        currentTime + (
          Number.isFinite(retryAfterSeconds)
            ? retryAfterSeconds * 1000
            : fallbackMs
        )
      );
    }
  }

  function updateLimitsFromExchangeInfo(exchangeInfo) {
    if (exchangeInfo?.product === 'spot') return;
    for (const limit of exchangeInfo?.rateLimits || []) {
      const value = finiteNonNegative(limit?.limit, 0);
      if (value <= 0) continue;
      if (
        limit.rateLimitType === 'REQUEST_WEIGHT' &&
        limit.interval === 'MINUTE' &&
        Number(limit.intervalNum) === 1
      ) {
        configuredLimits.requestWeight1m = value;
      }
      if (limit.rateLimitType === 'ORDERS') {
        if (limit.interval === 'SECOND' && Number(limit.intervalNum) === 10) {
          configuredLimits.orderCount10s = value;
        }
        if (limit.interval === 'MINUTE' && Number(limit.intervalNum) === 1) {
          configuredLimits.orderCount1m = value;
        }
      }
    }
  }

  function getState() {
    const currentTime = now();
    refreshAll(currentTime);
    const used = Object.fromEntries(
      Object.entries(windows).map(([key, value]) => [key, value.used])
    );
    return {
      backoffActive: blockedUntil > currentTime,
      blockedUntil,
      budgetRatios: { ...budgetRatios },
      deniedByPriority: Object.fromEntries(deniedByPriority),
      headroom: {
        orderCount10s: Math.max(
          0,
          configuredLimits.orderCount10s - used.orderCount10s
        ),
        orderCount1m: Math.max(
          0,
          configuredLimits.orderCount1m - used.orderCount1m
        ),
        requestWeight1m: Math.max(
          0,
          configuredLimits.requestWeight1m - used.requestWeight1m
        )
      },
      lastLimitStatus,
      lastObservedAt,
      ready: initialObservationReady,
      limits: { ...configuredLimits },
      utilization: {
        orderCount10s: utilization(
          used.orderCount10s,
          configuredLimits.orderCount10s
        ),
        orderCount1m: utilization(
          used.orderCount1m,
          configuredLimits.orderCount1m
        ),
        requestWeight1m: utilization(
          used.requestWeight1m,
          configuredLimits.requestWeight1m
        )
      },
      used
    };
  }

  return {
    getState,
    observeResponse,
    reserve,
    updateLimitsFromExchangeInfo
  };
}

let sharedCoordinator = null;

export function getSharedBinanceRateCoordinator() {
  if (!sharedCoordinator) {
    sharedCoordinator = createBinanceRateCoordinator({
      requireInitialObservation: true
    });
  }
  return sharedCoordinator;
}

export function estimateBinanceRateCost({ endpoint, method = 'GET', params = {} }) {
  const path = String(endpoint || '').split('?')[0];
  const normalizedMethod = String(method).toUpperCase();
  const limit = Number(params.limit || 0);
  const hasSymbol = Boolean(params.symbol);
  let requestWeight = null;

  if (path.startsWith('/api/')) {
    if (path.endsWith('/time') || path.endsWith('/ping')) {
      requestWeight = 1;
    } else if (path.endsWith('/exchangeInfo')) {
      requestWeight = 20;
    } else if (path.endsWith('/klines')) {
      requestWeight = 2;
    } else if (path.endsWith('/depth')) {
      requestWeight = limit > 1_000 ? 250 : limit > 500 ? 50 : limit > 100 ? 25 : 5;
    } else if (path.endsWith('/ticker/24hr')) {
      requestWeight = hasSymbol ? 2 : 80;
    } else if (path.endsWith('/ticker/bookTicker')) {
      requestWeight = hasSymbol ? 2 : 5;
    } else if (path.endsWith('/openOrders')) {
      requestWeight = hasSymbol ? 6 : 80;
    } else if (path.endsWith('/myTrades') || path.endsWith('/account')) {
      requestWeight = 20;
    } else if (path.endsWith('/order')) {
      requestWeight = normalizedMethod === 'GET' ? 4 : 1;
    }
  } else if (path.startsWith('/sapi/')) {
    if (path.endsWith('/algo/spot/newOrderAlgo')) requestWeight = 10;
  } else if (path.endsWith('/time') || path.endsWith('/ping') || path.endsWith('/exchangeInfo')) {
    requestWeight = 1;
  } else if (path.endsWith('/klines')) {
    requestWeight = limit > 1_000 ? 10 : limit >= 500 ? 5 : limit >= 100 ? 2 : 1;
  } else if (path.endsWith('/depth')) {
    requestWeight = limit > 1_000 ? 50 : limit > 500 ? 20 : limit > 100 ? 10 : 5;
  } else if (path.endsWith('/ticker/24hr')) {
    requestWeight = hasSymbol ? 1 : 40;
  } else if (path.endsWith('/premiumIndex')) {
    requestWeight = hasSymbol ? 1 : 10;
  } else if (path.endsWith('/ticker/bookTicker')) {
    requestWeight = hasSymbol ? 2 : 5;
  } else if (path.endsWith('/openOrders') || path.endsWith('/openAlgoOrders')) {
    requestWeight = hasSymbol ? 1 : 40;
  } else if (path.endsWith('/positionRisk') || path.endsWith('/account')) {
    requestWeight = 5;
  } else if (path.endsWith('/positionSide/dual')) {
    requestWeight = 30;
  } else if (path.endsWith('/commissionRate')) {
    requestWeight = 20;
  } else if (path.endsWith('/income')) {
    requestWeight = 30;
  } else if (path.endsWith('/userTrades')) {
    requestWeight = 5;
  } else if (path.includes('/futures/data/') || path.endsWith('/openInterest')) {
    requestWeight = 1;
  } else if (path.endsWith('/fundingRate')) {
    requestWeight = 1;
  } else if (path.endsWith('/leverageBracket')) {
    requestWeight = 1;
  } else if (
    path.endsWith('/order') ||
    path.endsWith('/algoOrder') ||
    path.endsWith('/allOpenOrders') ||
    path.endsWith('/marginType') ||
    path.endsWith('/leverage')
  ) {
    requestWeight = 1;
  } else if (path.endsWith('/stock/contract')) {
    requestWeight = 100;
  }

  if (requestWeight === null) {
    const error = new Error(
      `Unknown Binance endpoint weight: ${normalizedMethod} ${path}`
    );
    error.code = 'UNKNOWN_BINANCE_ENDPOINT_WEIGHT';
    throw error;
  }

  const isOrderMutation =
    normalizedMethod !== 'GET' &&
    /\/(order|algoOrder|newOrderAlgo|batchOrders|allOpenOrders)$/u.test(path);
  return {
    orderCount: isOrderMutation && normalizedMethod !== 'DELETE' ? 1 : 0,
    requestWeight
  };
}

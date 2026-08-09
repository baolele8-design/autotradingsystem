const DEFAULT_KLINE_LIMIT = 250;
const KLINE_STREAM_STALE_MS = 90_000;

function klineKey(symbol, interval) {
  return `${symbol.toUpperCase()}:${interval}`;
}

function normalizeKline(payload) {
  return [
    payload.t,
    payload.o,
    payload.h,
    payload.l,
    payload.c,
    payload.v,
    payload.T,
    payload.q,
    payload.n,
    payload.V,
    payload.Q,
    payload.B ?? '0'
  ];
}

function mergeKlines(current, incoming, limit) {
  const byOpenTime = new Map();
  for (const candle of current || []) byOpenTime.set(Number(candle[0]), candle);
  for (const candle of incoming || []) byOpenTime.set(Number(candle[0]), candle);
  return [...byOpenTime.values()]
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .slice(-limit);
}

function normalizeTicker(update) {
  return {
    symbol: update.s,
    priceChange: update.p,
    priceChangePercent: update.P,
    weightedAvgPrice: update.w,
    lastPrice: update.c,
    lastQty: update.Q,
    openPrice: update.o,
    highPrice: update.h,
    lowPrice: update.l,
    volume: update.v,
    quoteVolume: update.q,
    openTime: update.O,
    closeTime: update.C,
    firstId: update.F,
    lastId: update.L,
    count: update.n,
    updatedAt: Date.now()
  };
}

function normalizeBookTicker(update) {
  return {
    symbol: update.s,
    bidPrice: update.b,
    bidQty: update.B,
    askPrice: update.a,
    askQty: update.A,
    time: update.E || update.T || Date.now(),
    updatedAt: Date.now()
  };
}

function normalizePremiumIndex(update) {
  return {
    symbol: update.s,
    markPrice: update.p,
    indexPrice: update.i,
    estimatedSettlePrice: update.P,
    lastFundingRate: update.r,
    nextFundingTime: update.T,
    time: update.E,
    updatedAt: Date.now()
  };
}

export function createMarketDataCache({
  markPriceCache,
  safeFetch,
  klineLimit = DEFAULT_KLINE_LIMIT
}) {
  const klineCache = new Map();
  const klineInFlight = new Map();
  const ticker24hCache = new Map();
  const bookTickerCache = new Map();
  const premiumIndexCache = new Map();
  const priceListeners = new Set();
  let requestKlineSubscription = () => {};

  function setKlineSubscriptionHandler(handler) {
    requestKlineSubscription =
      typeof handler === 'function' ? handler : () => {};
  }

  function updateKline(update) {
    if (!update?.s || !update?.k?.i) return;
    const key = klineKey(update.s, update.k.i);
    const existing = klineCache.get(key) || {
      bootstrapped: false,
      candles: [],
      lastRestAt: 0,
      lastWsAt: 0
    };
    existing.candles = mergeKlines(
      existing.candles,
      [normalizeKline(update.k)],
      klineLimit
    );
    existing.lastWsAt = Date.now();
    klineCache.set(key, existing);
  }

  async function getKlines(symbol, interval, limit = klineLimit) {
    const normalizedSymbol = symbol.toUpperCase();
    const key = klineKey(normalizedSymbol, interval);
    requestKlineSubscription(normalizedSymbol, interval);

    const existing = klineCache.get(key);
    const streamIsFresh =
      existing?.lastWsAt &&
      Date.now() - existing.lastWsAt < KLINE_STREAM_STALE_MS;
    const restIsFresh =
      existing?.lastRestAt &&
      Date.now() - existing.lastRestAt < KLINE_STREAM_STALE_MS;
    if (existing?.bootstrapped && (streamIsFresh || restIsFresh)) {
      return existing.candles.slice(-limit);
    }

    if (klineInFlight.has(key)) {
      const candles = await klineInFlight.get(key);
      return candles?.slice(-limit) ?? null;
    }

    const request = (async () => {
      const response = await safeFetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${normalizedSymbol}&interval=${interval}&limit=${Math.max(limit, klineLimit)}`,
        {
          cacheKey: `KLINES:${key}:${Math.max(limit, klineLimit)}`,
          maxRetries: 2,
          ttlMs: 0
        }
      );
      if (!Array.isArray(response) || response.length === 0) {
        return existing?.candles?.length ? existing.candles : null;
      }

      const latest = klineCache.get(key) || existing || {
        candles: [],
        lastWsAt: 0
      };
      const next = {
        bootstrapped: true,
        candles: mergeKlines(
          response,
          latest.candles,
          Math.max(limit, klineLimit)
        ),
        lastRestAt: Date.now(),
        lastWsAt: latest.lastWsAt || 0
      };
      klineCache.set(key, next);
      return next.candles;
    })();

    klineInFlight.set(key, request);
    try {
      const candles = await request;
      return candles?.slice(-limit) ?? null;
    } finally {
      klineInFlight.delete(key);
    }
  }

  function updateMarkPrice(update) {
    const symbol = update?.s;
    const price = Number.parseFloat(update?.p);
    if (!symbol || !Number.isFinite(price) || price <= 0) return;

    const previous = markPriceCache.get(symbol);
    const next = {
      price,
      high: previous ? Math.max(previous.high, price) : price,
      low: previous ? Math.min(previous.low, price) : price,
      updatedAt: Date.now()
    };
    markPriceCache.set(symbol, next);
    premiumIndexCache.set(symbol, normalizePremiumIndex(update));

    for (const listener of priceListeners) {
      listener({
        eventTime: Number.isFinite(Number(update.E))
          ? Number(update.E)
          : next.updatedAt,
        price,
        symbol,
        updatedAt: next.updatedAt
      });
    }
  }

  function updateTicker24h(update) {
    if (update?.s) ticker24hCache.set(update.s, normalizeTicker(update));
  }

  function updateBookTicker(update) {
    if (update?.s) {
      bookTickerCache.set(update.s, normalizeBookTicker(update));
    }
  }

  return {
    getBookTicker: symbol => bookTickerCache.get(symbol.toUpperCase()) || null,
    getBookTickerAll: () =>
      bookTickerCache.size >= 10
        ? [...bookTickerCache.values()]
        : null,
    getKlines,
    getPremiumIndex: symbol =>
      premiumIndexCache.get(symbol.toUpperCase()) || null,
    getPremiumIndexAll: () =>
      premiumIndexCache.size >= 10
        ? [...premiumIndexCache.values()]
        : null,
    getStats: () => ({
      bookTickers: bookTickerCache.size,
      klineSeries: klineCache.size,
      premiumIndexes: premiumIndexCache.size,
      tickers24h: ticker24hCache.size
    }),
    getTicker24h: symbol => ticker24hCache.get(symbol.toUpperCase()) || null,
    getTicker24hAll: () =>
      ticker24hCache.size >= 10
        ? [...ticker24hCache.values()]
        : null,
    onPriceUpdate(listener) {
      priceListeners.add(listener);
      return () => priceListeners.delete(listener);
    },
    pruneKlines(olderThan) {
      for (const [key, entry] of klineCache) {
        if (Math.max(entry.lastRestAt || 0, entry.lastWsAt || 0) < olderThan) {
          klineCache.delete(key);
        }
      }
    },
    setKlineSubscriptionHandler,
    updateBookTicker,
    updateKline,
    updateMarkPrice,
    updateTicker24h
  };
}
